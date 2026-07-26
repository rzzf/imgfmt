import type { RolldownPlugin, RollupPlugin } from "unplugin";

import { generateRuntimeSource } from ".";
import { normalizeOptions } from "../core/options";
import { isCssModuleId, processCssModule } from "../css/transform";
import type { ImgfmtOptions } from "../types";
import {
  decodeHtmlAssetSource,
  injectDocumentBootstrap,
  relativeRuntimeUrl,
  runtimeAssetFileName,
} from "./document";

const pluginName = "imgfmt";

interface RuntimePlan {
  readonly fileName: string;
  readonly source: string;
}

interface RuntimeOutput {
  readonly fileName: string;
  readonly type: string;
}

interface RuntimeOutputAsset extends RuntimeOutput {
  source: string | Uint8Array;
}

interface RuntimePluginContext {
  emitFile(file: {
    readonly fileName: string;
    readonly source: string;
    readonly type: "asset";
  }): string;
  error(error: Error | string): never;
  getFileName(referenceId: string): string;
}

type RuntimeOutputBundle = Record<string, RuntimeOutput>;

/** Native Rollup hooks used by the unplugin adapter. */
export function createRollupHooks(inputOptions: ImgfmtOptions = {}): Partial<RollupPlugin> {
  const runtime = createRuntimePlan(inputOptions, "rollup");

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
          runtime,
          "rollup",
        );
      },
    },
  };
}

/** Native Rolldown hooks used by the unplugin adapter. */
export function createRolldownHooks(inputOptions: ImgfmtOptions = {}): Partial<RolldownPlugin> {
  const runtime = createRuntimePlan(inputOptions, "rolldown");

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
          runtime,
          "rolldown",
        );
      },
    },
  };
}

function createRuntimePlan(
  inputOptions: ImgfmtOptions,
  framework: "rolldown" | "rollup",
): RuntimePlan {
  if (inputOptions.document !== undefined) {
    throw new TypeError(
      `imgfmt/${framework} owns emitted HTML; the document option is only supported by imgfmt/esbuild`,
    );
  }

  const options = normalizeOptions(inputOptions);
  const source = generateRuntimeSource({
    deadlineMs: options.probeDeadlineMs,
    formats: options.formats,
  });

  return {
    fileName: runtimeAssetFileName(source),
    source,
  };
}

function installRuntimeInBundle(
  context: RuntimePluginContext,
  bundle: RuntimeOutputBundle,
  runtime: RuntimePlan,
  framework: "rolldown" | "rollup",
): void {
  const htmlAssets = Object.values(bundle).filter(isHtmlAsset);

  if (htmlAssets.length === 0) {
    context.error(
      `${pluginName}/${framework} requires at least one emitted HTML document to install the exact-one bootstrap`,
    );
  }

  if (Object.values(bundle).some((output) => output.fileName === runtime.fileName)) {
    context.error(
      `${pluginName}/${framework} cannot emit ${runtime.fileName} because that asset already exists`,
    );
  }

  const transformedDocuments = htmlAssets.map((asset) => ({
    asset,
    source: injectDocumentBootstrap(
      decodeHtmlAssetSource(asset.source),
      relativeRuntimeUrl(asset.fileName, runtime.fileName),
    ),
  }));
  const referenceId = context.emitFile({
    fileName: runtime.fileName,
    source: runtime.source,
    type: "asset",
  });
  const emittedFileName = context.getFileName(referenceId);

  if (emittedFileName !== runtime.fileName) {
    context.error(
      `${pluginName}/${framework} emitted an unexpected runtime path: ${emittedFileName}`,
    );
  }

  for (const document of transformedDocuments) {
    document.asset.source = document.source;
  }
}

function isHtmlAsset(output: RuntimeOutput): output is RuntimeOutputAsset {
  return output.type === "asset" && /\.html?$/i.test(output.fileName);
}
