import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";

import html from "@rollup/plugin-html";
import { rollup, type OutputAsset, type OutputChunk, type Plugin, type RollupOutput } from "rollup";
import { describe, expect, it } from "vite-plus/test";

import imgfmt from "../../src/rollup";

describe("imgfmt/rollup", () => {
  it("transforms source CSS before asset handling and installs the runtime in nested HTML", async () => {
    await withFixture(async (fixture) => {
      const bundle = await rollup({
        input: fixture.entry,
        plugins: [imgfmt(), createCssAssetPlugin(), html({ fileName: "pages/index.html" })],
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
      const bundle = await rollup({
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
  const root = await mkdtemp(join(tmpdir(), "imgfmt-rollup-"));
  const sourceDirectory = join(root, "src");

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(sourceDirectory, "main.js"), 'import "./style.css";\n'),
      writeFile(
        join(sourceDirectory, "style.css"),
        ".hero { background: #123 center / cover no-repeat url('./hero.png'); }\n" +
          '.remote { background-image: url("https://cdn.example/hero.png"); }\n',
      ),
      writeFile(join(sourceDirectory, "hero.png"), "original image"),
      writeFile(join(sourceDirectory, "hero.webp"), "webp image"),
      writeFile(join(sourceDirectory, "hero.avif"), "avif image"),
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
    async transform(code, id) {
      if (!id.toLowerCase().endsWith(".css")) {
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
      return { code: "export {};", map: null, moduleSideEffects: true };
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

function assertSuccessfulBuild(output: RollupOutput): void {
  const htmlAsset = requiredAsset(output.output, "pages/index.html");
  const cssAsset = requiredAsset(output.output, "assets/style.css");
  const runtimeAssets = output.output.filter(
    (item): item is OutputAsset =>
      item.type === "asset" && /^imgfmt-runtime-[a-f0-9]{12}\.js$/.test(item.fileName),
  );

  expect(runtimeAssets).toHaveLength(1);
  const runtimeAsset = runtimeAssets[0];

  if (runtimeAsset === undefined) {
    throw new Error("Expected one imgfmt runtime asset");
  }

  const htmlSource = textSource(htmlAsset);
  const cssSource = textSource(cssAsset);
  const runtimeTag = htmlSource.match(/<script[^>]*data-imgfmt-runtime[^>]*><\/script>/)?.[0];

  expect(htmlSource).toContain('<html data-imgcaps="pending"');
  expect(runtimeTag).toContain(" async");
  expect(runtimeTag).toContain(`src="../${runtimeAsset.fileName}"`);
  expect(runtimeTag).not.toContain(" defer");
  expect(runtimeTag).not.toContain(" type=");
  expect(cssSource).toContain("data-imgcaps");
  expect(cssSource).toContain("no-avif");
  expect(cssSource).toContain("no-webp");
  expect(cssSource).toMatch(/background-image:\s*url\('\.\/hero-[A-Za-z0-9_-]+\.avif'\)/);
  expect(cssSource).toMatch(/background-image:\s*url\('\.\/hero-[A-Za-z0-9_-]+\.webp'\)/);
  expect(cssSource).toMatch(/url\('\.\/hero-[A-Za-z0-9_-]+\.png'\)/);
  expect(cssSource).toContain('url("https://cdn.example/hero.png")');
  expect(cssSource).not.toContain("https://cdn.example/hero.avif");
  expect(cssSource).not.toContain("https://cdn.example/hero.webp");
  expect(output.output.some((item) => item.fileName.endsWith(".avif"))).toBe(true);
  expect(output.output.some((item) => item.fileName.endsWith(".webp"))).toBe(true);
  expect(output.output.some((item) => item.fileName.endsWith(".png"))).toBe(true);
  expect(textSource(runtimeAsset)).toContain("new I()");
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
