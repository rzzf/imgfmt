import type { UnpluginOptions } from "unplugin";

import { installVitePostcss } from "../css/vite";
import type { ImgfmtOptions } from "../types";
import {
  assertDocumentBootstrap,
  assertRuntimeMarkerAvailable,
  decodeHtmlAssetSource,
  developmentRuntimePath,
  injectPendingCapabilityState,
  runtimeAssetName,
} from "./document";

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

interface RuntimeBuildAsset extends RuntimeBuildOutput {
  readonly source: string | Uint8Array;
}

type RuntimeOutputBundle = Readonly<Record<string, RuntimeBuildOutput>>;
type RuntimeMiddlewareNext = () => void;
type RuntimeMiddleware = (
  request: RuntimeMiddlewareRequest,
  response: RuntimeMiddlewareResponse,
  next: RuntimeMiddlewareNext,
) => void;

export function createViteHooks(
  inputOptions: ImgfmtOptions | undefined,
  runtimeSource: string,
): NonNullable<UnpluginOptions["vite"]> {
  if (inputOptions?.document !== undefined) {
    throw new TypeError("imgfmt/vite owns Vite HTML entries; remove the document option");
  }

  let base = "/";
  let command: "build" | "serve" = "serve";
  let shouldEmitRuntime = false;
  const expectedRuntimeUrls = new Map<string, string>();

  return {
    config(config): void {
      installVitePostcss(config, inputOptions);
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
      expectedRuntimeUrls.clear();

      if (shouldEmitRuntime) {
        this.emitFile({
          name: runtimeAssetName,
          source: runtimeSource,
          type: "asset",
        });
      }
    },
    generateBundle: {
      order: "post",
      handler(_outputOptions, bundle): void {
        if (!shouldEmitRuntime) {
          return;
        }

        const htmlAssets = Object.values(bundle as unknown as RuntimeOutputBundle).filter(
          isHtmlAsset,
        );

        if (htmlAssets.length === 0) {
          this.error(
            "imgfmt/vite requires at least one HTML entry to install the document bootstrap",
          );
        }

        if (htmlAssets.length !== expectedRuntimeUrls.size) {
          this.error(
            `imgfmt/vite prepared ${expectedRuntimeUrls.size} HTML bootstrap(s), but found ${htmlAssets.length} emitted document(s)`,
          );
        }

        for (const asset of htmlAssets) {
          const runtimeUrl = expectedRuntimeUrls.get(normalizeHtmlPath(asset.fileName));

          if (runtimeUrl === undefined) {
            this.error(`imgfmt/vite did not prepare a bootstrap for ${asset.fileName}`);
          }

          assertDocumentBootstrap(decodeHtmlAssetSource(asset.source), runtimeUrl);
        }
      },
    },
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        assertRuntimeMarkerAvailable(html);
        const transformedHtml = injectPendingCapabilityState(html);
        const runtimeUrl =
          context.server === undefined
            ? buildRuntimeUrl(
                base,
                context.path,
                findRuntimeAsset(context.bundle as unknown as RuntimeOutputBundle | undefined),
              )
            : joinBase(base, developmentRuntimePath);

        if (context.server === undefined) {
          const outputPath = normalizeHtmlPath(context.path);

          if (expectedRuntimeUrls.has(outputPath)) {
            throw new Error(`imgfmt/vite already prepared a bootstrap for ${outputPath}`);
          }

          expectedRuntimeUrls.set(outputPath, runtimeUrl);
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
  };
}

function isHtmlAsset(output: RuntimeBuildOutput): output is RuntimeBuildAsset {
  return output.type === "asset" && /\.html?$/i.test(output.fileName) && "source" in output;
}

function normalizeHtmlPath(path: string): string {
  return path.split(/[?#]/, 1)[0]?.replace(/^\/+/, "") || "index.html";
}

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
