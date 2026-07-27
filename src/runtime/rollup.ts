import type { RolldownPlugin, RollupPlugin } from "unplugin";

import { generateRuntimeSource } from ".";
import { normalizeOptions } from "../core/options";
import { isCssModuleId, processCssModule } from "../css/transform";
import type { ImgfmtOptions } from "../types";
import { decodeHtmlAssetSource, injectDocumentBootstrap } from "./document";

const pluginName = "imgfmt";

interface RuntimeOutput {
  readonly fileName: string;
  readonly type: string;
}

interface RuntimeOutputAsset extends RuntimeOutput {
  source: string | Uint8Array;
}

interface RuntimePluginContext {
  error(error: Error | string): never;
}

type RuntimeOutputBundle = Record<string, RuntimeOutput>;

/** Native Rollup hooks used by the unplugin adapter. */
export function createRollupHooks(inputOptions: ImgfmtOptions = {}): Partial<RollupPlugin> {
  const runtimeSource = createRuntimeSource(inputOptions, "rollup");

  return {
    async transform(code, id) {
      if (inputOptions.postcss === "manual" || !isCssModuleId(id)) {
        return null;
      }

      return await processCssModule(code, id, inputOptions, { allowImports: true });
    },
    generateBundle: {
      order: "post",
      handler(_outputOptions, bundle): void {
        installRuntimeInBundle(
          this as unknown as RuntimePluginContext,
          bundle as unknown as RuntimeOutputBundle,
          runtimeSource,
          "rollup",
        );
      },
    },
  };
}

/** Native Rolldown hooks used by the unplugin adapter. */
export function createRolldownHooks(inputOptions: ImgfmtOptions = {}): Partial<RolldownPlugin> {
  const runtimeSource = createRuntimeSource(inputOptions, "rolldown");

  return {
    async transform(code, id, meta) {
      if (inputOptions.postcss === "manual" || (meta.moduleType !== "css" && !isCssModuleId(id))) {
        return null;
      }

      return await processCssModule(code, id, inputOptions, { allowImports: true });
    },
    generateBundle: {
      order: "post",
      handler(_outputOptions, bundle): void {
        installRuntimeInBundle(
          this as unknown as RuntimePluginContext,
          bundle as unknown as RuntimeOutputBundle,
          runtimeSource,
          "rolldown",
        );
      },
    },
  };
}

function createRuntimeSource(
  inputOptions: ImgfmtOptions,
  framework: "rolldown" | "rollup",
): string {
  if (inputOptions.document !== undefined) {
    throw new TypeError(
      `imgfmt/${framework} owns emitted HTML; the document option is only supported by imgfmt/esbuild`,
    );
  }

  const options = normalizeOptions(inputOptions);
  return generateRuntimeSource({
    deadlineMs: options.probeDeadlineMs,
    formats: options.formats,
  });
}

function installRuntimeInBundle(
  context: RuntimePluginContext,
  bundle: RuntimeOutputBundle,
  runtimeSource: string,
  framework: "rolldown" | "rollup",
): void {
  const htmlAssets = Object.values(bundle).filter(isHtmlAsset);

  if (htmlAssets.length === 0) {
    context.error(
      `${pluginName}/${framework} requires at least one emitted HTML document to install the exact-one bootstrap`,
    );
  }

  for (const asset of htmlAssets) {
    asset.source = injectDocumentBootstrap(decodeHtmlAssetSource(asset.source), runtimeSource);
  }
}

function isHtmlAsset(output: RuntimeOutput): output is RuntimeOutputAsset {
  return output.type === "asset" && /\.html?$/i.test(output.fileName);
}
