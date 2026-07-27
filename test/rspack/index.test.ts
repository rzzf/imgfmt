import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { rspack, type Configuration, type RspackPluginInstance, type Stats } from "@rspack/core";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vite-plus/test";

import imgfmtPostcss from "../../src/postcss";
import imgfmt from "../../src/rspack";
import { defaultFormatProbes, generateRuntimeSource } from "../../src/runtime";

const require = createRequire(import.meta.url);
const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url));
const runtimeSource = generateRuntimeSource({ formats: defaultFormatProbes });

describe("imgfmt/rspack runtime", () => {
  it("uses Rspack's native CSS and HTML pipelines for every candidate and the runtime", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "imgfmt-rspack-"));
    const outputDirectory = join(temporaryRoot, "dist");

    try {
      await compile(createRspackConfig(outputDirectory));

      const files = await listFiles(outputDirectory);
      const html = await readFile(join(outputDirectory, "pages/index.html"), "utf8");
      const cssFile = requiredFile(files, (file) => file.endsWith(".css"), "CSS asset");
      const css = await readFile(join(outputDirectory, cssFile), "utf8");
      const runtimeTag = requiredRuntimeTag(html);

      expect(html).toContain('data-imgcaps="pending"');
      expect(runtimeTag.tag).toContain(" data-imgfmt-runtime");
      expect(runtimeTag.tag).not.toContain(" async");
      expect(runtimeTag.tag).not.toContain(" src=");
      expect(runtimeTag.tag).not.toContain(" defer");
      expect(runtimeTag.tag).not.toContain(" nomodule");
      expect(runtimeTag.tag).not.toContain(" type=");
      expect(html.indexOf(runtimeTag.tag)).toBeLessThan(html.indexOf('src="/static/assets/main.'));

      expect(css).toContain("data-imgcaps");
      expect(css).not.toContain("no-avif");
      expect(css).not.toContain("no-webp");
      expect(css).toContain("linear-gradient");
      expect(css).toContain("https://cdn.example.com/remote.png");
      expect(css).toContain("//cdn.example.com/remote.png");
      expect(css).not.toContain("remote.avif");
      expect(css).not.toContain("remote.webp");
      assertImageValueIsPreserved(css);
      expect(files.some((file) => file.endsWith(".avif"))).toBe(true);
      expect(files.some((file) => file.endsWith(".webp"))).toBe(true);
      expect(files.some((file) => file.endsWith(".png"))).toBe(true);
      expect(runtimeTag.source).toBe(runtimeSource);
      expect(files.filter((file) => file.startsWith("imgfmt-runtime"))).toEqual([]);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("requires explicit manual PostCSS integration", () => {
    expect(() =>
      rspack(
        createRspackConfig(join(tmpdir(), "imgfmt-rspack-auto"), {
          postcss: "auto",
        }),
      ),
    ).toThrow('requires postcss: "manual"');
  });

  it("requires HtmlRspackPlugin and a document target", () => {
    const withoutHtml: Configuration = {
      context: fixtureRoot,
      entry: "./src/index.js",
      mode: "production",
      output: { path: join(tmpdir(), "imgfmt-rspack-no-html") },
      plugins: [rspackRuntimePlugin()],
      target: "web",
    };

    expect(() => rspack(withoutHtml)).toThrow("requires rspack.HtmlRspackPlugin");
    expect(() =>
      rspack(
        createRspackConfig(join(tmpdir(), "imgfmt-rspack-worker"), {
          target: "webworker",
        }),
      ),
    ).toThrow("supports document/client builds only");
  });

  it("rejects esbuild-only document ownership", () => {
    expect(() =>
      imgfmt({
        document: { files: ["index.html"], mode: "static" },
        postcss: "manual",
      }),
    ).toThrow("owns emitted HTML");
  });
});

interface RspackConfigOverrides {
  readonly postcss?: "auto" | "manual";
  readonly target?: Configuration["target"];
}

function createRspackConfig(
  outputDirectory: string,
  overrides: RspackConfigOverrides = {},
): Configuration {
  const postcss = overrides.postcss ?? "manual";

  return {
    context: fixtureRoot,
    devtool: false,
    entry: "./src/index.js",
    mode: "production",
    module: {
      rules: [
        {
          test: /\.css$/i,
          type: "css/auto",
          use: [
            {
              loader: require.resolve("postcss-loader"),
              options: {
                postcssOptions: {
                  plugins: [imgfmtPostcss({ postcss: "manual" })],
                },
              },
            },
          ],
        },
        {
          generator: { filename: "media/[name].[contenthash:8][ext]" },
          test: /\.(?:avif|png|webp)$/i,
          type: "asset/resource",
        },
      ],
    },
    optimization: { sideEffects: false },
    output: {
      assetModuleFilename: "media/[name].[contenthash:8][ext]",
      clean: true,
      cssFilename: "assets/[name].[contenthash:8].css",
      filename: "assets/[name].[contenthash:8].js",
      path: outputDirectory,
      publicPath: "/static/",
    },
    plugins: [
      new rspack.HtmlRspackPlugin({
        filename: "pages/index.html",
        scriptLoading: "module",
        template: join(fixtureRoot, "index.html"),
      }),
      rspackRuntimePlugin(postcss),
    ],
    target: overrides.target ?? "web",
  };
}

function rspackRuntimePlugin(postcss: "auto" | "manual" = "manual"): RspackPluginInstance {
  return imgfmt({ postcss });
}

async function compile(config: Configuration): Promise<Stats> {
  const compiler = rspack(config);

  return await new Promise<Stats>((resolve, reject) => {
    compiler.run((runError, stats) => {
      compiler.close((closeError) => {
        const error = runError ?? closeError;

        if (error !== null && error !== undefined) {
          reject(error);
          return;
        }

        if (stats === undefined) {
          reject(new Error("Rspack completed without stats"));
          return;
        }

        if (stats.hasErrors()) {
          reject(new Error(stats.toString({ all: false, errorDetails: true, errors: true })));
          return;
        }

        resolve(stats);
      });
    });
  });
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, path)));
    } else {
      files.push(path);
    }
  }

  return files.sort();
}

function requiredFile(
  files: readonly string[],
  predicate: (file: string) => boolean,
  description: string,
): string {
  const matches = files.filter(predicate);

  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`Expected one ${description}, found ${matches.length}`);
  }

  return matches[0];
}

function requiredRuntimeTag(html: string): { readonly source: string; readonly tag: string } {
  const matches = [
    ...html.matchAll(/<script\b[^>]*data-imgfmt-runtime[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  const match = matches[0];

  if (matches.length !== 1 || match?.[1] === undefined) {
    throw new Error(`Expected one imgfmt runtime tag, found ${matches.length}`);
  }

  return { source: match[1], tag: match[0] };
}

function assertImageValueIsPreserved(css: string): void {
  const stylesheet = postcss.parse(css);
  const mirrors = stylesheet.nodes.filter(
    (node): node is Rule =>
      node.type === "rule" &&
      node.selector.includes("data-imgcaps") &&
      node.selector.endsWith(" .banner"),
  );

  expect(mirrors.length).toBeGreaterThan(0);
  expect(
    mirrors.every((rule) =>
      rule.nodes.every(
        (node) =>
          node.type !== "decl" ||
          (node.prop === "background-image" && node.value.includes("linear-gradient")),
      ),
    ),
  ).toBe(true);
}
