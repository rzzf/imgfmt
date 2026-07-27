/// <reference types="node" />

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { build, context, version } from "esbuild";
import postcss, { type Declaration, type Rule } from "postcss";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { normalizeOptions } from "../../src/core/options";
import imgfmtPlugin from "../../src/esbuild";
import { generateRuntimeSource } from "../../src/runtime";
import type { ImgfmtDocumentManifest, ImgfmtOptions } from "../../src/types";

interface Fixture {
  readonly html: string;
  readonly main: string;
  readonly output: string;
  readonly root: string;
  readonly style: string;
}

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { force: true, recursive: true })));
  temporaryRoots.clear();
});

describe("imgfmt/esbuild", () => {
  it("uses the supported esbuild release line", () => {
    expect(version).toMatch(/^0\.28\./);
  });

  it("builds host-owned image assets and static HTML with an inline runtime", async () => {
    const fixture = await createFixture("imgfmt-esbuild-static-");

    const result = await build({
      absPaths: ["metafile"],
      absWorkingDir: fixture.root,
      assetNames: "assets/[name]-[hash]",
      bundle: true,
      entryNames: "assets/[name]-[hash]",
      entryPoints: [fixture.main],
      loader: imageLoaders,
      logLevel: "silent",
      outdir: fixture.output,
      plugins: [
        imgfmtPlugin({
          document: {
            files: [{ input: fixture.html, output: "index.html" }],
            mode: "static",
          },
        }),
      ],
    });

    const files = await listFiles(fixture.output);
    const cssPath = requiredFile(files, (file) => file.endsWith(".css"), "CSS output");
    const html = await readFile(join(fixture.output, "index.html"), "utf8");
    const css = await readFile(join(fixture.output, cssPath), "utf8");
    const runtime = requiredInlineRuntime(html);
    const normalized = normalizeOptions();

    expect(result.metafile).toBeDefined();
    expect(html).toContain('<html data-imgcaps="pending"');
    expect(html).not.toMatch(/<script[^>]*data-imgfmt-runtime[^>]*(?:async|src=|type=)/);
    expect(css).toContain("data-imgcaps");
    expect(css).not.toContain("no-avif");
    expect(css).not.toContain("no-webp");
    expect(runtime).toBe(
      generateRuntimeSource({
        deadlineMs: normalized.probeDeadlineMs,
        formats: normalized.formats,
      }),
    );
    expect(runtime).not.toContain("Promise");
    expect(files.some((file) => file.startsWith("imgfmt-runtime-"))).toBe(false);
    expect(files.some((file) => file.endsWith(".png"))).toBe(true);
    expect(files.some((file) => file.endsWith(".webp"))).toBe(true);
    expect(files.some((file) => file.endsWith(".avif"))).toBe(true);

    await expectAssetContents(fixture.output, files, ".png", "original image");
    await expectAssetContents(fixture.output, files, ".webp", "webp image");
    await expectAssetContents(fixture.output, files, ".avif", "avif image");
  });

  it("returns an in-memory manifest and outputs when write is false", async () => {
    const fixture = await createFixture("imgfmt-esbuild-memory-");
    let manifest: ImgfmtDocumentManifest | undefined;

    const result = await build({
      absWorkingDir: fixture.root,
      assetNames: "assets/[name]-[hash]",
      bundle: true,
      entryNames: "assets/[name]-[hash]",
      entryPoints: [fixture.main],
      loader: imageLoaders,
      logLevel: "silent",
      outdir: fixture.output,
      plugins: [
        imgfmtPlugin({
          document: {
            mode: "manual",
            onManifest(value): void {
              manifest = value;
            },
          },
        }),
      ],
      write: false,
    });

    expect(manifest).toBeDefined();
    expect(result.outputFiles).toBeDefined();
    expect(result.outputFiles?.some((file) => file.path.includes("imgfmt-runtime"))).toBe(false);

    const html = manifest?.install("<html><head></head><body></body></html>") ?? "";
    const runtime = requiredInlineRuntime(html);

    expect(html).toContain('data-imgcaps="pending"');
    expect(runtime).toContain("new ImageConstructor()");
  });

  it("keeps the inline runtime independent of esbuild publicPath", async () => {
    const fixture = await createFixture("imgfmt-esbuild-public-path-");

    await build({
      absWorkingDir: fixture.root,
      bundle: true,
      entryNames: "assets/[name]-[hash]",
      entryPoints: [fixture.main],
      loader: imageLoaders,
      logLevel: "silent",
      outdir: fixture.output,
      plugins: [
        imgfmtPlugin({
          document: {
            files: [{ input: fixture.html, output: "nested/index.html" }],
            mode: "static",
          },
        }),
      ],
      publicPath: "https://cdn.example.test/static",
    });

    const html = await readFile(join(fixture.output, "nested/index.html"), "utf8");

    expect(requiredInlineRuntime(html)).toContain("new ImageConstructor()");
    expect(html).not.toContain("imgfmt-runtime-");
  });

  it("accepts relative public paths because the runtime has no URL", async () => {
    const fixture = await createFixture("imgfmt-esbuild-relative-public-path-");

    await build({
      absWorkingDir: fixture.root,
      bundle: true,
      entryNames: "assets/[name]-[hash]",
      entryPoints: [fixture.main],
      loader: imageLoaders,
      logLevel: "silent",
      outdir: fixture.output,
      plugins: [
        imgfmtPlugin({
          document: {
            files: [{ input: fixture.html, output: "nested/index.html" }],
            mode: "static",
          },
        }),
      ],
      publicPath: "./",
    });

    const html = await readFile(join(fixture.output, "nested/index.html"), "utf8");
    expect(requiredInlineRuntime(html)).toContain("new ImageConstructor()");

    const relativeOutput = join(fixture.root, "relative-dist");
    await build({
      absWorkingDir: fixture.root,
      bundle: true,
      entryPoints: [fixture.main],
      loader: imageLoaders,
      logLevel: "silent",
      outdir: relativeOutput,
      plugins: [
        imgfmtPlugin({
          document: { files: [fixture.html], mode: "static" },
        }),
      ],
      publicPath: "static",
    });
    expect(
      requiredInlineRuntime(await readFile(join(relativeOutput, "index.html"), "utf8")),
    ).toContain("new ImageConstructor()");
  });

  it("preserves image values, derives background-image, and skips protocol URLs", async () => {
    const fixture = await createFixture("imgfmt-esbuild-values-");

    await writeFile(
      fixture.style,
      `
.shorthand { background: #123 url("./background.png") center / cover no-repeat; }
.layered { background-image: linear-gradient(17deg, red 5%, transparent 95%), url("./background.png"); }
.mixed { background-image: url("https://cdn.example.test/texture.png?x=1#top"), url("./background.png"); }
.remote { background-image: url("https://cdn.example.test/remote-background.png?x=1#top"); }
`,
    );

    await build({
      absWorkingDir: fixture.root,
      assetNames: "assets/[name]-[hash]",
      bundle: true,
      entryNames: "assets/[name]-[hash]",
      entryPoints: [fixture.main],
      loader: imageLoaders,
      logLevel: "silent",
      outdir: fixture.output,
      plugins: [
        imgfmtPlugin({
          document: {
            files: [fixture.html],
            mode: "static",
          },
        }),
      ],
    });

    const files = await listFiles(fixture.output);
    const cssPath = requiredFile(files, (file) => file.endsWith(".css"), "CSS output");
    const css = await readFile(join(fixture.output, cssPath), "utf8");
    const rules = parseCssRules(css);
    const originalShorthand = requiredRule(rules, (rule) => rule.selector === ".shorthand");
    const originalLayered = requiredRule(rules, (rule) => rule.selector === ".layered");
    const originalMixed = requiredRule(rules, (rule) => rule.selector === ".mixed");
    const shorthandMirrors = rules.filter(
      (rule) => rule.selector.includes("data-imgcaps") && rule.selector.includes(".shorthand"),
    );
    const layeredMirrors = rules.filter(
      (rule) => rule.selector.includes("data-imgcaps") && rule.selector.includes(".layered"),
    );
    const mixedMirrors = rules.filter(
      (rule) => rule.selector.includes("data-imgcaps") && rule.selector.includes(".mixed"),
    );
    const remoteMirrors = rules.filter(
      (rule) => rule.selector.includes("data-imgcaps") && rule.selector.includes(".remote"),
    );

    expect(declarationValue(originalShorthand, "background")).toContain("center / cover no-repeat");
    expect(declarationValue(originalShorthand, "background")).toContain("none");
    expect(declarationValue(originalShorthand, "background")).not.toContain(".png");
    expect(shorthandMirrors).toHaveLength(3);
    expect(
      shorthandMirrors.every((rule) =>
        rule.nodes?.every((node) => node.type !== "decl" || node.prop === "background-image"),
      ),
    ).toBe(true);
    expect(
      shorthandMirrors.map((rule) => declarationValue(rule, "background-image")).join("\n"),
    ).toContain(".avif");
    expect(
      shorthandMirrors.map((rule) => declarationValue(rule, "background-image")).join("\n"),
    ).toContain(".webp");
    expect(
      shorthandMirrors.every(
        (rule) => !declarationValue(rule, "background-image").includes("cover"),
      ),
    ).toBe(true);

    expect(declarationValue(originalLayered, "background-image")).toContain("linear-gradient");
    expect(declarationValue(originalLayered, "background-image")).toContain("none");
    expect(layeredMirrors).toHaveLength(3);
    expect(
      layeredMirrors.every((rule) =>
        compactCssValue(declarationValue(rule, "background-image")).includes(
          "linear-gradient(17deg,red 5%,transparent 95%)",
        ),
      ),
    ).toBe(true);
    expect(declarationValue(originalMixed, "background-image")).toContain(
      "https://cdn.example.test/texture.png?x=1#top",
    );
    expect(declarationValue(originalMixed, "background-image")).toContain("none");
    expect(mixedMirrors).toHaveLength(3);
    expect(
      mixedMirrors.every((rule) =>
        declarationValue(rule, "background-image").includes(
          "https://cdn.example.test/texture.png?x=1#top",
        ),
      ),
    ).toBe(true);
    expect(css).not.toContain("cdn.example.test/texture.avif");
    expect(css).not.toContain("cdn.example.test/texture.webp");
    expect(remoteMirrors).toHaveLength(0);
  });

  it("lets esbuild resolve imported CSS after each module is transformed", async () => {
    const fixture = await createFixture("imgfmt-esbuild-imports-");
    const importedStyle = join(dirname(fixture.style), "imported.css");

    await writeFile(
      fixture.style,
      '@import "./imported.css";\n.main { background-image: url("./background.png"); }\n',
    );
    await writeFile(importedStyle, '.imported { background: url("./background.png") center; }\n');

    await build({
      absWorkingDir: fixture.root,
      assetNames: "assets/[name]-[hash]",
      bundle: true,
      entryNames: "assets/[name]-[hash]",
      entryPoints: [fixture.main],
      loader: imageLoaders,
      logLevel: "silent",
      outdir: fixture.output,
      plugins: [
        imgfmtPlugin({
          document: {
            files: [fixture.html],
            mode: "static",
          },
        }),
      ],
    });

    const files = await listFiles(fixture.output);
    const cssPath = requiredFile(files, (file) => file.endsWith(".css"), "CSS output");
    const css = await readFile(join(fixture.output, cssPath), "utf8");

    expect(css).toContain(".imported");
    expect(css).toContain(".main");
    expect(css.match(/data-imgcaps/g)?.length).toBeGreaterThan(2);
  });

  it("preserves esbuild's default local CSS loader for CSS Modules", async () => {
    const fixture = await createFixture("imgfmt-esbuild-modules-");
    const moduleStyle = join(dirname(fixture.style), "style.module.css");

    await writeFile(moduleStyle, '.banner { background-image: url("./background.png"); }\n');
    await writeFile(
      fixture.main,
      'import { banner } from "./style.module.css";\nconsole.log(banner);\n',
    );

    await build({
      absWorkingDir: fixture.root,
      assetNames: "assets/[name]-[hash]",
      bundle: true,
      entryNames: "assets/[name]-[hash]",
      entryPoints: [fixture.main],
      loader: imageLoaders,
      logLevel: "silent",
      outdir: fixture.output,
      plugins: [
        imgfmtPlugin({
          document: {
            files: [fixture.html],
            mode: "static",
          },
        }),
      ],
    });

    const files = await listFiles(fixture.output);
    const cssPath = requiredFile(files, (file) => file.endsWith(".css"), "CSS output");
    const jsPath = requiredFile(
      files,
      (file) => file.endsWith(".js") && !file.includes("imgfmt-runtime"),
      "JavaScript output",
    );
    const css = await readFile(join(fixture.output, cssPath), "utf8");
    const js = await readFile(join(fixture.output, jsPath), "utf8");

    expect(css).toContain("data-imgcaps");
    expect(css).not.toContain(":local");
    expect(js).toMatch(/style_banner|banner/);
  });

  it("rebuilds a context with the generated static document and inline runtime", async () => {
    const fixture = await createFixture("imgfmt-esbuild-context-");
    const ctx = await context({
      absWorkingDir: fixture.root,
      bundle: true,
      entryNames: "assets/[name]-[hash]",
      entryPoints: [fixture.main],
      loader: imageLoaders,
      logLevel: "silent",
      outdir: fixture.output,
      plugins: [
        imgfmtPlugin({
          document: {
            files: [{ input: fixture.html, output: "index.html" }],
            mode: "static",
          },
        }),
      ],
    });

    try {
      await ctx.rebuild();
      const files = await listFiles(fixture.output);
      const html = await readFile(join(fixture.output, "index.html"), "utf8");
      const runtime = requiredInlineRuntime(html);

      expect(runtime).toContain("new ImageConstructor()");
      expect(runtime).not.toContain("Promise");
      expect(files.some((file) => file.startsWith("imgfmt-runtime-"))).toBe(false);
    } finally {
      await ctx.dispose();
    }
  });

  it("rebuilds when a manual document watch file changes", async () => {
    const fixture = await createFixture("imgfmt-esbuild-watch-");
    let manifestCount = 0;
    const ctx = await context({
      absWorkingDir: fixture.root,
      bundle: true,
      entryNames: "assets/[name]-[hash]",
      entryPoints: [fixture.main],
      loader: imageLoaders,
      logLevel: "silent",
      outdir: fixture.output,
      plugins: [
        imgfmtPlugin({
          document: {
            mode: "manual",
            onManifest(): void {
              manifestCount += 1;
            },
            watchFiles: [fixture.html],
          },
        }),
      ],
    });

    try {
      await ctx.watch({ delay: 10 });
      await waitFor(() => manifestCount >= 1);
      await writeFile(
        fixture.html,
        "<html><head><title>changed</title></head><body></body></html>\n",
      );
      await waitFor(() => manifestCount >= 2);
    } finally {
      await ctx.dispose();
    }
  });

  it("fails closed for unsupported build and CSS ownership configurations", async () => {
    const fixture = await createFixture("imgfmt-esbuild-errors-");
    const manualDocument: ImgfmtOptions["document"] = {
      mode: "manual",
      onManifest(): void {},
    };

    await expect(
      build({
        bundle: true,
        entryPoints: [fixture.main],
        loader: imageLoaders,
        logLevel: "silent",
        outdir: fixture.output,
        plugins: [imgfmtPlugin({})],
      }),
    ).rejects.toThrow("requires document mode");

    await expect(
      build({
        bundle: false,
        entryPoints: [fixture.main],
        logLevel: "silent",
        outdir: fixture.output,
        plugins: [imgfmtPlugin({ document: manualDocument })],
      }),
    ).rejects.toThrow("requires bundle: true");

    await expect(
      build({
        bundle: true,
        entryPoints: [fixture.main],
        loader: { ".css": "empty" },
        logLevel: "silent",
        outdir: fixture.output,
        plugins: [imgfmtPlugin({ document: manualDocument })],
      }),
    ).rejects.toThrow("cannot transform CSS configured with the empty loader");

    await expect(
      build({
        bundle: true,
        entryPoints: [fixture.main],
        loader: imageLoaders,
        logLevel: "silent",
        outdir: fixture.output,
        plugins: [
          {
            name: "competing-css-loader",
            setup(pluginBuild): void {
              pluginBuild.onLoad({ filter: /\.css$/ }, async (args) => ({
                contents: await readFile(args.path, "utf8"),
                loader: "css",
                resolveDir: dirname(args.path),
              }));
            },
          },
          imgfmtPlugin({ document: manualDocument }),
        ],
      }),
    ).rejects.toThrow("did not transform every CSS input");
  });
});

const imageLoaders = {
  ".avif": "file",
  ".png": "file",
  ".webp": "file",
} as const;

async function createFixture(prefix: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.add(root);
  const source = join(root, "src");
  const main = join(source, "main.js");
  const style = join(source, "style.css");
  const html = join(root, "index.html");

  await mkdir(source, { recursive: true });
  await Promise.all([
    writeFile(main, 'import "./style.css";\n'),
    writeFile(style, '.banner { background-image: url("./background.png"); }\n'),
    writeFile(join(source, "background.png"), "original image"),
    writeFile(join(source, "background.webp"), "webp image"),
    writeFile(join(source, "background.avif"), "avif image"),
    writeFile(html, '<html><head></head><body><div class="banner"></div></body></html>\n'),
  ]);

  return {
    html,
    main,
    output: join(root, "dist"),
    root,
    style,
  };
}

async function listFiles(root: string, directory = root): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = join(directory, entry.name);

      return entry.isDirectory()
        ? listFiles(root, path)
        : [relative(root, path).replaceAll("\\", "/")];
    }),
  );

  return files.flat().sort();
}

function requiredFile(
  files: readonly string[],
  predicate: (file: string) => boolean,
  description: string,
): string {
  const file = files.find(predicate);

  if (file === undefined) {
    throw new Error(`Missing ${description}: ${files.join(", ")}`);
  }

  return file;
}

function parseCssRules(css: string): readonly Rule[] {
  const rules: Rule[] = [];
  postcss.parse(css).walkRules((rule) => {
    rules.push(rule);
  });
  return rules;
}

function requiredRule(rules: readonly Rule[], predicate: (rule: Rule) => boolean): Rule {
  const rule = rules.find(predicate);

  if (rule === undefined) {
    throw new Error("Missing expected CSS rule");
  }

  return rule;
}

function declarationValue(rule: Rule, property: string): string {
  const declaration = rule.nodes?.find(
    (node): node is Declaration => node.type === "decl" && node.prop === property,
  );

  if (declaration === undefined) {
    throw new Error(`Missing ${property} declaration in ${rule.selector}`);
  }

  return declaration.value;
}

function compactCssValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

async function expectAssetContents(
  outputDirectory: string,
  files: readonly string[],
  extension: string,
  expected: string,
): Promise<void> {
  const path = requiredFile(files, (file) => file.endsWith(extension), `${extension} asset`);

  expect(await readFile(join(outputDirectory, path), "utf8")).toBe(expected);
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

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for esbuild watch rebuild");
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}
