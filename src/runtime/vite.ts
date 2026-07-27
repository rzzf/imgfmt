import type { UnpluginOptions } from "unplugin";

import { installVitePostcss } from "../css/vite";
import type { ImgfmtOptions } from "../types";
import {
  assertDocumentBootstrap,
  decodeHtmlAssetSource,
  injectDocumentBootstrap,
} from "./document";

interface RuntimeBuildOutput {
  readonly fileName: string;
  readonly source?: string | Uint8Array | undefined;
  readonly type: string;
}

type RuntimeOutputBundle = Readonly<Record<string, RuntimeBuildOutput>>;

export function createViteHooks(
  inputOptions: ImgfmtOptions | undefined,
  runtimeSource: string,
): NonNullable<UnpluginOptions["vite"]> {
  if (inputOptions?.document !== undefined) {
    throw new TypeError("imgfmt/vite owns Vite HTML entries; remove the document option");
  }

  let shouldValidateDocuments = false;
  const preparedDocuments = new Set<string>();

  return {
    config(config): void {
      installVitePostcss(config, inputOptions);
    },
    configResolved(config): void {
      if (config.command === "build" && (config.isWorker || config.build.ssr)) {
        throw new TypeError(
          "imgfmt/vite supports document/client builds only; remove it from SSR and worker plugin lists",
        );
      }

      if (config.command === "build" && config.build.lib) {
        throw new TypeError(
          "imgfmt/vite requires an HTML application build; use imgfmt/postcss for CSS libraries",
        );
      }

      shouldValidateDocuments = config.command === "build";
    },
    buildStart(): void {
      preparedDocuments.clear();
    },
    generateBundle: {
      order: "post",
      handler(_outputOptions, bundle): void {
        if (!shouldValidateDocuments) {
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

        if (htmlAssets.length !== preparedDocuments.size) {
          this.error(
            `imgfmt/vite prepared ${preparedDocuments.size} HTML bootstrap(s), but found ${htmlAssets.length} emitted document(s)`,
          );
        }

        for (const asset of htmlAssets) {
          if (!preparedDocuments.has(normalizeHtmlPath(asset.fileName))) {
            this.error(`imgfmt/vite did not prepare a bootstrap for ${asset.fileName}`);
          }

          assertDocumentBootstrap(decodeHtmlAssetSource(asset.source), runtimeSource);
        }
      },
    },
    transformIndexHtml: {
      order: "post",
      handler(html, context): string {
        if (context.server === undefined) {
          const outputPath = normalizeHtmlPath(context.path);

          if (preparedDocuments.has(outputPath)) {
            throw new Error(`imgfmt/vite already prepared a bootstrap for ${outputPath}`);
          }

          preparedDocuments.add(outputPath);
        }

        return injectDocumentBootstrap(html, runtimeSource);
      },
    },
  };
}

function isHtmlAsset(
  output: RuntimeBuildOutput,
): output is RuntimeBuildOutput & { readonly source: string | Uint8Array } {
  return (
    output.type === "asset" && /\.html?$/i.test(output.fileName) && output.source !== undefined
  );
}

function normalizeHtmlPath(path: string): string {
  return path.split(/[?#]/, 1)[0]?.replace(/^\/+/, "") || "index.html";
}
