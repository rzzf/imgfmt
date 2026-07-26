import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import process from "node:process";

import { createUnplugin, type UnpluginInstance } from "unplugin";

import { postcssPlugin } from "./css";
import { normalizeOptions } from "./options";
import { capabilityAttribute, generateRuntimeSource, pendingCapabilityState } from "./runtime";
import type { ImgfmtOptions } from "./types";

const runtimeAssetName = "imgfmt-runtime.js";
const developmentRuntimePath = "/@imgfmt/runtime.js";
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

interface RuntimeMiddlewareRequest {
  readonly method?: string | undefined;
  readonly originalUrl?: string | undefined;
  readonly url?: string | undefined;
}

interface RuntimeMiddlewareResponse {
  statusCode: number;
  end(body?: string): void;
  setHeader(name: string, value: string): void;
}

interface RuntimeBuildOutput {
  readonly fileName: string;
  readonly name?: string | undefined;
  readonly names?: readonly string[] | undefined;
  readonly type: string;
}

type RuntimeOutputBundle = Readonly<Record<string, RuntimeBuildOutput>>;

interface HtmlAttribute {
  readonly name: string;
  readonly value?: string | undefined;
}

type RuntimeMiddlewareNext = () => void;
type RuntimeMiddleware = (
  request: RuntimeMiddlewareRequest,
  response: RuntimeMiddlewareResponse,
  next: RuntimeMiddlewareNext,
) => void;

const imgfmt: UnpluginInstance<ImgfmtOptions | undefined, false> = createUnplugin<
  ImgfmtOptions | undefined,
  false
>((inputOptions) => {
  const options = normalizeOptions(inputOptions);
  const runtimeSource = generateRuntimeSource({
    deadlineMs: options.probeDeadlineMs,
    formats: options.formats,
  });
  let base = "/";
  let command: "build" | "serve" = "serve";
  let didTransformBuildHtml = false;
  let shouldEmitRuntime = false;

  return {
    enforce: "post",
    name: "imgfmt",
    vite: {
      config(config): void {
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
      },
      configResolved(config): void {
        base = config.base;
        command = config.command;

        if (command === "build" && (config.isWorker || config.build.ssr)) {
          throw new TypeError(
            "imgfmt/vite supports document/client builds only; remove it from SSR and worker plugin lists",
          );
        }

        if (command === "build" && config.build.lib) {
          throw new TypeError(
            "imgfmt/vite requires an HTML application build; use imgfmt/postcss for CSS libraries",
          );
        }

        shouldEmitRuntime = command === "build";

        if (shouldEmitRuntime && config.experimental.renderBuiltUrl !== undefined) {
          throw new TypeError("imgfmt does not support Vite experimental.renderBuiltUrl yet");
        }
      },
      configureServer(server): void {
        const middleware = createDevelopmentRuntimeMiddleware(base, runtimeSource);
        server.middlewares.use((request, response, next) => {
          middleware(request, response as unknown as RuntimeMiddlewareResponse, (): void => {
            next();
          });
        });
      },
      buildStart(): void {
        didTransformBuildHtml = false;

        if (shouldEmitRuntime) {
          this.emitFile({
            name: runtimeAssetName,
            source: runtimeSource,
            type: "asset",
          });
        }
      },
      generateBundle(): void {
        if (shouldEmitRuntime && !didTransformBuildHtml) {
          this.error(
            "imgfmt/vite requires at least one HTML entry to install the document bootstrap",
          );
        }
      },
      transformIndexHtml: {
        order: "post",
        handler(html, context) {
          const transformedHtml = injectPendingCapabilityState(html);
          const runtimeUrl =
            context.server === undefined
              ? buildRuntimeUrl(base, context.path, findRuntimeAsset(context.bundle))
              : joinBase(base, developmentRuntimePath);

          if (context.server === undefined) {
            didTransformBuildHtml = true;
          }

          return {
            html: transformedHtml,
            tags: [
              {
                attrs: {
                  async: true,
                  "data-imgfmt-runtime": true,
                  src: runtimeUrl,
                },
                injectTo: "head-prepend",
                tag: "script",
              },
            ],
          };
        },
      },
    },
  };
});

export default imgfmt;

export function createDevelopmentRuntimeMiddleware(
  base: string,
  runtimeSource: string,
): RuntimeMiddleware {
  const servedPath = joinBase(base, developmentRuntimePath);
  const acceptedPaths = new Set([developmentRuntimePath, servedPath]);

  return (request, response, next): void => {
    const requestUrl = request.originalUrl ?? request.url;
    const pathname = requestUrl?.split(/[?#]/, 1)[0];
    const method = request.method ?? "GET";

    if (
      pathname === undefined ||
      !acceptedPaths.has(pathname) ||
      (method !== "GET" && method !== "HEAD")
    ) {
      next();
      return;
    }

    response.statusCode = 200;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(method === "HEAD" ? undefined : runtimeSource);
  };
}

function injectPendingCapabilityState(html: string): string {
  const openingTagRange = findHtmlOpeningTag(html);
  const openingTag = html.slice(openingTagRange.start, openingTagRange.end);
  const capabilityAttributes = readHtmlAttributes(openingTag).filter(
    (attribute) => attribute.name.toLowerCase() === capabilityAttribute,
  );

  if (
    capabilityAttributes.length > 1 ||
    (capabilityAttributes.length === 1 && capabilityAttributes[0]?.value !== pendingCapabilityState)
  ) {
    throw new Error(`imgfmt owns the ${capabilityAttribute} attribute on <html>`);
  }

  if (capabilityAttributes.length === 1) {
    return html;
  }

  const replacement = openingTag.replace(
    /^<html/i,
    (tagName) => `${tagName} ${capabilityAttribute}="${pendingCapabilityState}"`,
  );
  return `${html.slice(0, openingTagRange.start)}${replacement}${html.slice(openingTagRange.end)}`;
}

function readHtmlAttributes(openingTag: string): readonly HtmlAttribute[] {
  const attributes: HtmlAttribute[] = [];
  let index = 5;

  while (index < openingTag.length) {
    while (/\s/.test(openingTag[index] ?? "")) {
      index += 1;
    }

    if (openingTag[index] === ">" || openingTag.startsWith("/>", index)) {
      break;
    }

    const nameStart = index;

    while (index < openingTag.length && !/[\s=/>]/.test(openingTag[index] ?? "")) {
      index += 1;
    }

    if (index === nameStart) {
      throw new Error("imgfmt could not parse the <html> attributes safely");
    }

    const name = openingTag.slice(nameStart, index);

    while (/\s/.test(openingTag[index] ?? "")) {
      index += 1;
    }

    if (openingTag[index] !== "=") {
      attributes.push({ name });
      continue;
    }

    index += 1;

    while (/\s/.test(openingTag[index] ?? "")) {
      index += 1;
    }

    const quote = openingTag[index];

    if (quote === '"' || quote === "'") {
      const valueStart = ++index;

      while (index < openingTag.length && openingTag[index] !== quote) {
        index += 1;
      }

      if (openingTag[index] !== quote) {
        throw new Error("imgfmt found an unclosed <html> attribute value");
      }

      attributes.push({ name, value: openingTag.slice(valueStart, index) });
      index += 1;
      continue;
    }

    const valueStart = index;

    while (index < openingTag.length && !/[\s>]/.test(openingTag[index] ?? "")) {
      index += 1;
    }

    attributes.push({ name, value: openingTag.slice(valueStart, index) });
  }

  return attributes;
}

function findHtmlOpeningTag(html: string): { readonly end: number; readonly start: number } {
  let index = 0;

  while (index < html.length) {
    if (html.startsWith("<!--", index)) {
      const commentEnd = html.indexOf("-->", index + 4);

      if (commentEnd === -1) {
        break;
      }

      index = commentEnd + 3;
      continue;
    }

    if (
      html[index] === "<" &&
      html.slice(index + 1, index + 5).toLowerCase() === "html" &&
      /[\s/>]/.test(html[index + 5] ?? "")
    ) {
      let quote: '"' | "'" | undefined;

      for (let cursor = index + 5; cursor < html.length; cursor += 1) {
        const character = html[cursor];

        if (quote !== undefined) {
          if (character === quote) {
            quote = undefined;
          }
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === ">") {
          return { end: cursor + 1, start: index };
        }
      }

      throw new Error("imgfmt found an unclosed <html> element");
    }

    index += 1;
  }

  throw new Error("imgfmt requires an <html> element to install its static pending state");
}

function findRuntimeAsset(bundle: RuntimeOutputBundle | undefined): string {
  if (bundle === undefined) {
    throw new Error("imgfmt could not inspect the Vite build bundle for its runtime asset");
  }

  const matches = Object.values(bundle).filter(
    (output) =>
      output.type === "asset" &&
      (output.names?.includes(runtimeAssetName) === true || output.name === runtimeAssetName),
  );

  if (matches.length !== 1) {
    throw new Error(`imgfmt expected one ${runtimeAssetName} build asset, found ${matches.length}`);
  }

  const asset = matches[0];

  if (asset?.type !== "asset") {
    throw new Error(`imgfmt could not resolve the ${runtimeAssetName} build asset`);
  }

  return asset.fileName;
}

function buildRuntimeUrl(base: string, htmlPath: string, assetFileName: string): string {
  if (base === "" || base === "./") {
    const cleanHtmlPath = htmlPath.split(/[?#]/, 1)[0]?.replace(/^\/+/, "") ?? "index.html";
    const directoryDepth = Math.max(0, cleanHtmlPath.split("/").filter(Boolean).length - 1);
    const prefix = directoryDepth === 0 ? "./" : "../".repeat(directoryDepth);
    return `${prefix}${assetFileName}`;
  }

  return joinBase(base, `/${assetFileName}`);
}

function joinBase(base: string, pathname: string): string {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${pathname.replace(/^\/+/, "")}`;
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
