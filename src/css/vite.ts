import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import process from "node:process";

import { postcssPlugin } from ".";
import type { ImgfmtOptions } from "../types";
import type { ViteUserConfig } from "./types";

const postcssConfigNames = [
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ".postcssrc.ts",
  ".postcssrc.cts",
  ".postcssrc.mts",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.mjs",
  "postcss.config.ts",
  "postcss.config.cts",
  "postcss.config.mts",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
] as const;

export function installVitePostcss(
  config: ViteUserConfig,
  inputOptions: ImgfmtOptions | undefined,
): void {
  if (inputOptions?.postcss === "manual") {
    return;
  }

  if (config.css?.transformer === "lightningcss") {
    throw new TypeError(
      'imgfmt requires the PostCSS CSS transformer; use postcss: "manual" only if CSS is transformed before Vite',
    );
  }

  const css = (config.css ??= {});

  if (typeof css.postcss === "string") {
    throw new TypeError(
      'imgfmt cannot append itself when css.postcss sets a config search path; add imgfmt/postcss there and set postcss: "manual"',
    );
  }

  if (css.postcss === undefined) {
    const configPath = findPostcssConfig(config.root);

    if (configPath !== undefined) {
      throw new TypeError(
        `imgfmt found an external PostCSS config at ${configPath}; add imgfmt/postcss there and set postcss: "manual"`,
      );
    }
  }

  const postcssOptions = css.postcss ?? {};
  css.postcss = postcssOptions;
  const plugins = (postcssOptions.plugins ??= []);

  if (plugins.some(isImgfmtPostcssPlugin)) {
    throw new TypeError(
      'imgfmt/postcss is already configured; set postcss: "manual" on the Vite adapter',
    );
  }

  plugins.push(postcssPlugin(inputOptions));
}

function findPostcssConfig(root: string | undefined): string | undefined {
  const configuredRoot = root ?? process.cwd();
  let directory = isAbsolute(configuredRoot)
    ? configuredRoot
    : resolve(process.cwd(), configuredRoot);
  const searchBoundary = findWorkspaceSearchBoundary(directory);

  while (true) {
    for (const name of postcssConfigNames) {
      const candidate = join(directory, name);

      if (existsSync(candidate)) {
        return candidate;
      }
    }

    const packagePath = join(directory, "package.json");

    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown>;

      if (Object.hasOwn(packageJson, "postcss")) {
        return packagePath;
      }
    }

    if (directory === searchBoundary) {
      return undefined;
    }

    directory = dirname(directory);
  }
}

function findWorkspaceSearchBoundary(start: string): string {
  const packageRoot = findPackageRoot(start);
  let directory = start;
  const filesystemRoot = parse(start).root;

  while (true) {
    if (
      existsSync(join(directory, "pnpm-workspace.yaml")) ||
      existsSync(join(directory, "lerna.json")) ||
      hasWorkspaceManifest(directory)
    ) {
      return directory;
    }

    if (directory === filesystemRoot) {
      return packageRoot;
    }

    directory = dirname(directory);
  }
}

function findPackageRoot(start: string): string {
  let directory = start;
  const filesystemRoot = parse(start).root;

  while (true) {
    if (existsSync(join(directory, "package.json"))) {
      return directory;
    }

    if (directory === filesystemRoot) {
      return start;
    }

    directory = dirname(directory);
  }
}

function hasWorkspaceManifest(directory: string): boolean {
  const packageJson = readJsonObject(join(directory, "package.json"));

  if (packageJson !== undefined && Boolean(packageJson.workspaces)) {
    return true;
  }

  for (const name of ["deno.json", "deno.jsonc"]) {
    const denoJson = readJsonObject(join(directory, name));

    if (denoJson !== undefined && Boolean(denoJson.workspace)) {
      return true;
    }
  }

  return false;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isImgfmtPostcssPlugin(plugin: unknown): boolean {
  return (
    plugin === postcssPlugin ||
    (typeof plugin === "object" &&
      plugin !== null &&
      "postcssPlugin" in plugin &&
      plugin.postcssPlugin === "imgfmt")
  );
}
