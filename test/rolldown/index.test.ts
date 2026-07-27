import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";

import html from "@rollup/plugin-html";
import {
  rolldown,
  type OutputAsset,
  type OutputChunk,
  type Plugin,
  type RolldownOutput,
} from "rolldown";
import { describe, expect, it } from "vite-plus/test";

import imgfmt from "../../src/rolldown";

describe("imgfmt/rolldown", () => {
  it("transforms CSS modules before extraction and installs the runtime in nested HTML", async () => {
    await withFixture(async (fixture) => {
      const bundle = await rolldown({
        input: fixture.entry,
        plugins: [
          imgfmt(),
          createCssAssetPlugin(),
          html({ fileName: "pages/index.html" }) as unknown as Plugin,
        ],
      });

      try {
        const output = await bundle.generate(outputOptions);
        assertSuccessfulBuild(output);
      } finally {
        await bundle.close();
      }
    });
  });

  it("fails closed when no plugin emits an HTML document", async () => {
    await withFixture(async (fixture) => {
      const bundle = await rolldown({
        input: fixture.entry,
        plugins: [imgfmt(), createCssAssetPlugin()],
      });

      try {
        await expect(bundle.generate(outputOptions)).rejects.toThrow(
          "requires at least one emitted HTML document",
        );
      } finally {
        await bundle.close();
      }
    });
  });

  it("rejects esbuild-only document ownership options", () => {
    expect(() =>
      imgfmt({
        document: { files: ["index.html"], mode: "static" },
      }),
    ).toThrow("document option is only supported by imgfmt/esbuild");
  });
});

const outputOptions = {
  assetFileNames: "assets/[name]-[hash][extname]",
  entryFileNames: "assets/[name]-[hash].js",
  format: "es" as const,
};

interface Fixture {
  readonly entry: string;
}

interface CssModule {
  readonly references: ReadonlyMap<string, string>;
  readonly source: string;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "imgfmt-rolldown-"));
  const sourceDirectory = join(root, "src");

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(sourceDirectory, "main.js"), 'import "./style.css";\n'),
      writeFile(
        join(sourceDirectory, "style.css"),
        ".banner { background: #123 center / cover no-repeat url('./banner.png'); }\n" +
          '.remote { background-image: url("https://cdn.example/remote-banner.png"); }\n',
      ),
      writeFile(join(sourceDirectory, "banner.png"), "original image"),
      writeFile(join(sourceDirectory, "banner.webp"), "webp image"),
      writeFile(join(sourceDirectory, "banner.avif"), "avif image"),
    ]);
    await run({ entry: join(sourceDirectory, "main.js") });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function createCssAssetPlugin(): Plugin {
  const modules = new Map<string, CssModule>();

  return {
    name: "test-css-assets",
    async transform(code, id, meta) {
      if (meta.moduleType !== "css" && !id.toLowerCase().endsWith(".css")) {
        return null;
      }

      const references = new Map<string, string>();

      for (const url of readCssUrls(code)) {
        if (references.has(url)) {
          continue;
        }

        const path = resolve(dirname(id), url);
        references.set(
          url,
          this.emitFile({
            name: basename(path),
            source: await readFile(path),
            type: "asset",
          }),
        );
      }

      modules.set(id, { references, source: code });
      return {
        code: "export {};",
        map: null,
        moduleSideEffects: true,
        moduleType: "js",
      };
    },
    generateBundle(): void {
      const cssFileName = "assets/style.css";
      const source = [...modules.values()]
        .map((module) => rewriteCssAssetUrls(module, cssFileName, this.getFileName.bind(this)))
        .join("\n");

      this.emitFile({ fileName: cssFileName, source, type: "asset" });
    },
  };
}

function readCssUrls(source: string): readonly string[] {
  const urls: string[] = [];
  const pattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)/gi;

  for (const match of source.matchAll(pattern)) {
    const url = match[1] ?? match[2] ?? match[3];

    if (url !== undefined && (url.startsWith("./") || url.startsWith("../"))) {
      urls.push(url);
    }
  }

  return urls;
}

function rewriteCssAssetUrls(
  module: CssModule,
  cssFileName: string,
  getFileName: (referenceId: string) => string,
): string {
  let source = module.source;

  for (const [url, referenceId] of module.references) {
    const relativePath = posix.relative(
      posix.dirname(cssFileName),
      getFileName(referenceId).replaceAll("\\", "/"),
    );
    source = source.replaceAll(
      url,
      relativePath.startsWith(".") ? relativePath : `./${relativePath}`,
    );
  }

  return source;
}

function assertSuccessfulBuild(output: RolldownOutput): void {
  const htmlAsset = requiredAsset(output.output, "pages/index.html");
  const cssAsset = requiredAsset(output.output, "assets/style.css");
  const htmlSource = textSource(htmlAsset);
  const cssSource = textSource(cssAsset);
  const runtimeSource = requiredInlineRuntime(htmlSource);

  expect(htmlSource).toContain('<html data-imgcaps="pending"');
  expect(htmlSource).not.toMatch(/<script[^>]*data-imgfmt-runtime[^>]*(?:async|src=|type=)/);
  expect(cssSource).toContain("data-imgcaps");
  expect(cssSource).not.toContain("no-avif");
  expect(cssSource).not.toContain("no-webp");
  expect(cssSource).toMatch(/background-image:\s*url\('\.\/banner-[A-Za-z0-9_-]+\.avif'\)/);
  expect(cssSource).toMatch(/background-image:\s*url\('\.\/banner-[A-Za-z0-9_-]+\.webp'\)/);
  expect(cssSource).toMatch(/url\('\.\/banner-[A-Za-z0-9_-]+\.png'\)/);
  expect(cssSource).toContain('url("https://cdn.example/remote-banner.png")');
  expect(cssSource).not.toContain("https://cdn.example/remote-banner.avif");
  expect(cssSource).not.toContain("https://cdn.example/remote-banner.webp");
  expect(output.output.some((item) => item.fileName.endsWith(".avif"))).toBe(true);
  expect(output.output.some((item) => item.fileName.endsWith(".webp"))).toBe(true);
  expect(output.output.some((item) => item.fileName.endsWith(".png"))).toBe(true);
  expect(output.output.some((item) => item.fileName.startsWith("imgfmt-runtime-"))).toBe(false);
  expect(runtimeSource).toContain("new ImageConstructor()");
}

function requiredAsset(
  output: readonly (OutputAsset | OutputChunk)[],
  fileName: string,
): OutputAsset {
  const item = output.find(
    (candidate): candidate is OutputAsset =>
      candidate.type === "asset" && candidate.fileName === fileName,
  );

  if (item === undefined) {
    throw new Error(`Missing generated asset: ${fileName}`);
  }

  return item;
}

function textSource(asset: OutputAsset): string {
  return typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source);
}

function requiredInlineRuntime(html: string): string {
  const matches = [
    ...html.matchAll(/<script\b[^>]*data-imgfmt-runtime[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  const source = matches[0]?.[1];

  if (matches.length !== 1 || source === undefined) {
    throw new Error(`Expected one inline imgfmt runtime, found ${matches.length}`);
  }

  return source;
}
