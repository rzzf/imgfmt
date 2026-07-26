import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import HtmlWebpackPlugin from "html-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import postcss, { type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vite-plus/test";
import webpack, { type Configuration, type Stats, type WebpackPluginInstance } from "webpack";

import imgfmtPostcss from "../../src/postcss";
import { defaultFormatProbes, generateRuntimeSource } from "../../src/runtime";
import { runtimeAssetFileName } from "../../src/runtime/document";
import imgfmt from "../../src/webpack";

const require = createRequire(import.meta.url);
const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url));
const runtimeSource = generateRuntimeSource({ formats: defaultFormatProbes });
const runtimeFileName = runtimeAssetFileName(runtimeSource);

describe("imgfmt/webpack runtime", () => {
  it("builds source CSS variants and installs one classic async runtime in nested HTML", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "imgfmt-webpack-"));
    const outputDirectory = join(temporaryRoot, "dist");

    try {
      await compile(createWebpackConfig(outputDirectory));

      const files = await listFiles(outputDirectory);
      const html = await readFile(join(outputDirectory, "pages/index.html"), "utf8");
      const cssFile = requiredFile(files, (file) => file.endsWith(".css"), "CSS asset");
      const css = await readFile(join(outputDirectory, cssFile), "utf8");
      const runtime = await readFile(join(outputDirectory, runtimeFileName), "utf8");
      const runtimeTag = requiredRuntimeTag(html);

      expect(html).toContain('data-imgcaps="pending"');
      expect(runtimeTag).toContain(" async");
      expect(runtimeTag).toContain(" data-imgfmt-runtime");
      expect(runtimeTag).toContain(`src="../${runtimeFileName}"`);
      expect(runtimeTag).not.toContain(" defer");
      expect(runtimeTag).not.toContain(" nomodule");
      expect(runtimeTag).not.toContain(" type=");
      expect(html.indexOf(runtimeTag)).toBeLessThan(html.indexOf('src="../assets/main.'));

      expect(css).toContain("data-imgcaps");
      expect(css).toContain("no-avif");
      expect(css).toContain("no-webp");
      expect(css).toContain("center / cover no-repeat");
      expect(css).toContain("https://cdn.example.com/remote.png");
      expect(css).toContain("//cdn.example.com/remote.png");
      expect(css).not.toContain("remote.avif");
      expect(css).not.toContain("remote.webp");
      assertShorthandMirrorsOnlyItsImage(css);
      expect(files.some((file) => file.endsWith(".avif"))).toBe(true);
      expect(files.some((file) => file.endsWith(".webp"))).toBe(true);
      expect(files.some((file) => file.endsWith(".png"))).toBe(true);
      expect(runtime).toBe(runtimeSource);
      expect(files.filter((file) => file.startsWith("imgfmt-runtime"))).toEqual([runtimeFileName]);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("requires explicit manual PostCSS integration", () => {
    expect(() =>
      webpack(
        createWebpackConfig(join(tmpdir(), "imgfmt-webpack-auto"), {
          postcss: "auto",
        }),
      ),
    ).toThrow('requires postcss: "manual"');
  });

  it("requires HtmlWebpackPlugin and a document target", () => {
    const withoutHtml: Configuration = {
      context: fixtureRoot,
      entry: "./src/index.js",
      mode: "production",
      output: { path: join(tmpdir(), "imgfmt-webpack-no-html") },
      plugins: [webpackRuntimePlugin()],
      target: "web",
    };

    expect(() => webpack(withoutHtml)).toThrow("requires HtmlWebpackPlugin");
    expect(() =>
      webpack(
        createWebpackConfig(join(tmpdir(), "imgfmt-webpack-node"), {
          target: "node",
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

interface WebpackConfigOverrides {
  readonly postcss?: "auto" | "manual";
  readonly target?: Configuration["target"];
}

function createWebpackConfig(
  outputDirectory: string,
  overrides: WebpackConfigOverrides = {},
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
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: require.resolve("css-loader"),
              options: { importLoaders: 1 },
            },
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
      filename: "assets/[name].[contenthash:8].js",
      path: outputDirectory,
      publicPath: "auto",
    },
    plugins: [
      new HtmlWebpackPlugin({
        filename: "pages/index.html",
        scriptLoading: "module",
        template: join(fixtureRoot, "index.html"),
      }),
      new MiniCssExtractPlugin({ filename: "assets/[name].[contenthash:8].css" }),
      webpackRuntimePlugin(postcss),
    ],
    target: overrides.target ?? "web",
  };
}

function webpackRuntimePlugin(postcss: "auto" | "manual" = "manual"): WebpackPluginInstance {
  return imgfmt({ postcss });
}

async function compile(config: Configuration): Promise<Stats> {
  const compiler = webpack(config);

  return await new Promise<Stats>((resolve, reject) => {
    compiler.run((runError, stats) => {
      compiler.close((closeError) => {
        const error = runError ?? closeError;

        if (error !== null && error !== undefined) {
          reject(error);
          return;
        }

        if (stats === undefined) {
          reject(new Error("webpack completed without stats"));
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

function requiredRuntimeTag(html: string): string {
  const matches = html.match(/<script\b[^>]*data-imgfmt-runtime[^>]*><\/script>/gi) ?? [];

  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`Expected one imgfmt runtime tag, found ${matches.length}`);
  }

  return matches[0];
}

function assertShorthandMirrorsOnlyItsImage(css: string): void {
  const stylesheet = postcss.parse(css);
  const mirrors = stylesheet.nodes.filter(
    (node): node is Rule =>
      node.type === "rule" &&
      node.selector.includes("data-imgcaps") &&
      node.selector.endsWith(" .hero"),
  );
  const original = stylesheet.nodes.find(
    (node): node is Rule => node.type === "rule" && node.selector === ".hero",
  );
  const originalBackground = original?.nodes.find(
    (node): node is Declaration => node.type === "decl" && node.prop === "background",
  );

  expect(mirrors.length).toBeGreaterThan(0);
  expect(
    mirrors.every((rule) =>
      rule.nodes.every((node) => node.type !== "decl" || node.prop === "background-image"),
    ),
  ).toBe(true);
  expect(originalBackground?.value).toContain("center / cover no-repeat");
}
