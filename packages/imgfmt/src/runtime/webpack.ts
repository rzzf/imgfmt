import type { RspackCompiler, WebpackCompiler } from "unplugin";

import type { ImgfmtOptions } from "../types";
import {
  assertDocumentBootstrap,
  injectPendingCapabilityState,
  runtimeAssetFileName,
  runtimeMarkerAttribute,
} from "./document";

const pluginName = "imgfmt";
const installedCompilers = new WeakSet<object>();

type Framework = "rspack" | "webpack";

export interface InstallWebpackRuntimeOptions {
  readonly compiler: RspackCompiler | WebpackCompiler;
  readonly framework: Framework;
  readonly postcss: ImgfmtOptions["postcss"];
  readonly runtimeSource: string;
}

interface SourceLike {
  size(): number;
  source(): string | Uint8Array;
}

interface RawSourceConstructor {
  new (value: string): SourceLike;
}

interface CompilationConstructor {
  readonly PROCESS_ASSETS_STAGE_ADDITIONAL: number;
  readonly PROCESS_ASSETS_STAGE_REPORT: number;
}

interface ProcessAssetsHook {
  tap(options: { readonly name: string; readonly stage: number }, handler: () => void): void;
}

interface CompilationLike {
  emitAsset(
    name: string,
    source: SourceLike,
    info?: {
      readonly immutable?: boolean | undefined;
      readonly minimized?: boolean | undefined;
    },
  ): void;
  getAsset(name: string): unknown;
  readonly hooks: {
    readonly processAssets: ProcessAssetsHook;
  };
}

interface SyncHook<T> {
  tap(name: string, handler: (value: T) => void): void;
}

interface WebpackLikeCompiler {
  readonly hooks: {
    readonly thisCompilation: SyncHook<CompilationLike>;
  };
  readonly options: {
    readonly output: {
      readonly library?: unknown;
    };
    readonly plugins: readonly unknown[];
    readonly target?: unknown;
  };
  readonly rspack?: {
    readonly HtmlRspackPlugin?: HtmlPluginApi | undefined;
  };
  readonly webpack: {
    readonly Compilation: CompilationConstructor;
    readonly sources: {
      readonly RawSource: RawSourceConstructor;
    };
  };
}

interface PromiseWaterfallHook<T> {
  tapPromise(name: string, handler: (data: T) => Promise<T>): void;
}

interface HtmlPluginApi {
  readonly getCompilationHooks: (compilation: CompilationLike) => HtmlPluginHooks;
}

interface HtmlPluginData {
  readonly outputName: string;
  readonly plugin: object;
}

interface BeforeAssetTagGenerationData extends HtmlPluginData {
  readonly assets: {
    readonly publicPath: string;
    readonly js: string[];
  };
}

interface HtmlTag {
  attributes: Record<string, boolean | null | string | undefined>;
  readonly tagName: string;
  readonly voidTag: boolean;
}

interface AlterAssetTagsData extends HtmlPluginData {
  readonly assetTags: {
    readonly scripts: HtmlTag[];
  };
}

interface AlterAssetTagGroupsData extends HtmlPluginData {
  bodyTags: HtmlTag[];
  headTags: HtmlTag[];
}

interface BeforeEmitData extends HtmlPluginData {
  html: string;
}

interface HtmlPluginHooks {
  readonly alterAssetTagGroups: PromiseWaterfallHook<AlterAssetTagGroupsData>;
  readonly alterAssetTags: PromiseWaterfallHook<AlterAssetTagsData>;
  readonly beforeAssetTagGeneration: PromiseWaterfallHook<BeforeAssetTagGenerationData>;
  readonly beforeEmit: PromiseWaterfallHook<BeforeEmitData>;
}

/** Installs the document bootstrap shared by the webpack and Rspack adapters. */
export function installWebpackRuntime(options: InstallWebpackRuntimeOptions): void {
  if (options.postcss !== "manual") {
    throw new TypeError(
      `imgfmt/${options.framework} requires postcss: "manual" and imgfmt/postcss in the host CSS pipeline`,
    );
  }

  const compiler = options.compiler as unknown as WebpackLikeCompiler;

  if (installedCompilers.has(compiler)) {
    throw new TypeError(`imgfmt/${options.framework} is already installed on this compiler`);
  }

  assertDocumentCompiler(compiler, options.framework);
  const htmlPluginApis = findHtmlPluginApis(compiler, options.framework);

  if (htmlPluginApis.length === 0) {
    const requiredPlugin =
      options.framework === "webpack" ? "HtmlWebpackPlugin" : "rspack.HtmlRspackPlugin";
    throw new TypeError(
      `imgfmt/${options.framework} requires ${requiredPlugin} to install the document bootstrap`,
    );
  }

  installedCompilers.add(compiler);

  const runtimeFileName = runtimeAssetFileName(options.runtimeSource);
  const hookName = `${pluginName}/${options.framework}`;

  compiler.hooks.thisCompilation.tap(hookName, (compilation) => {
    const expectedRuntimeUrls = new Map<string, string>();
    const processedHtmlOutputs = new Set<string>();
    const installedHookSets = new Set<HtmlPluginHooks>();

    compilation.hooks.processAssets.tap(
      {
        name: hookName,
        stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
      },
      () => {
        if (compilation.getAsset(runtimeFileName) !== undefined) {
          throw new Error(
            `imgfmt/${options.framework} cannot emit ${runtimeFileName} because that asset already exists`,
          );
        }

        compilation.emitAsset(
          runtimeFileName,
          new compiler.webpack.sources.RawSource(options.runtimeSource),
          { immutable: true, minimized: true },
        );
      },
    );

    for (const htmlPluginApi of htmlPluginApis) {
      const hooks = htmlPluginApi.getCompilationHooks(compilation);

      if (installedHookSets.has(hooks)) {
        continue;
      }

      installedHookSets.add(hooks);
      installHtmlHooks(hooks, hookName, runtimeFileName, expectedRuntimeUrls, processedHtmlOutputs);
    }

    compilation.hooks.processAssets.tap(
      {
        name: hookName,
        stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
      },
      () => {
        if (processedHtmlOutputs.size === 0) {
          throw new Error(
            `imgfmt/${options.framework} requires at least one HTML output to install the document bootstrap`,
          );
        }
      },
    );
  });
}

function installHtmlHooks(
  hooks: HtmlPluginHooks,
  hookName: string,
  runtimeFileName: string,
  expectedRuntimeUrls: Map<string, string>,
  processedHtmlOutputs: Set<string>,
): void {
  hooks.beforeAssetTagGeneration.tapPromise(hookName, async (data) => {
    const publicPath = data.assets.publicPath;

    if (typeof publicPath !== "string" || publicPath === "auto") {
      throw new Error(`imgfmt could not resolve the public path for ${data.outputName}`);
    }

    const runtimeUrl = `${publicPath}${runtimeFileName}`;

    if (data.assets.js.includes(runtimeUrl)) {
      throw new Error(`imgfmt found a duplicate runtime URL in ${data.outputName}`);
    }

    data.assets.js.unshift(runtimeUrl);
    setExpectedRuntimeUrl(expectedRuntimeUrls, data.outputName, runtimeUrl);
    return data;
  });

  hooks.alterAssetTags.tapPromise(hookName, async (data) => {
    const runtimeUrl = getExpectedRuntimeUrl(expectedRuntimeUrls, data.outputName);
    const matches = data.assetTags.scripts.filter(
      (tag) => tag.tagName.toLowerCase() === "script" && tag.attributes.src === runtimeUrl,
    );

    if (matches.length !== 1) {
      throw new Error(
        `imgfmt expected one generated runtime script tag in ${data.outputName}, found ${matches.length}`,
      );
    }

    const runtimeTag = matches[0];

    if (runtimeTag === undefined) {
      throw new Error(`imgfmt could not resolve the runtime script tag in ${data.outputName}`);
    }

    delete runtimeTag.attributes.defer;
    delete runtimeTag.attributes.nomodule;
    delete runtimeTag.attributes.type;
    runtimeTag.attributes.async = true;
    runtimeTag.attributes[runtimeMarkerAttribute] = true;
    return data;
  });

  hooks.alterAssetTagGroups.tapPromise(hookName, async (data) => {
    const runtimeUrl = getExpectedRuntimeUrl(expectedRuntimeUrls, data.outputName);
    const matches = [...data.headTags, ...data.bodyTags].filter((tag) =>
      isRuntimeTag(tag, runtimeUrl),
    );

    if (matches.length !== 1) {
      throw new Error(
        `imgfmt expected one grouped runtime script tag in ${data.outputName}, found ${matches.length}`,
      );
    }

    const runtimeTag = matches[0];

    if (runtimeTag === undefined) {
      throw new Error(`imgfmt could not group the runtime script tag in ${data.outputName}`);
    }

    data.headTags = [runtimeTag, ...data.headTags.filter((tag) => !isRuntimeTag(tag, runtimeUrl))];
    data.bodyTags = data.bodyTags.filter((tag) => !isRuntimeTag(tag, runtimeUrl));
    return data;
  });

  hooks.beforeEmit.tapPromise(hookName, async (data) => {
    const runtimeUrl = getExpectedRuntimeUrl(expectedRuntimeUrls, data.outputName);
    data.html = injectPendingCapabilityState(data.html);
    assertDocumentBootstrap(data.html, runtimeUrl);
    processedHtmlOutputs.add(data.outputName);
    return data;
  });
}

function assertDocumentCompiler(compiler: WebpackLikeCompiler, framework: Framework): void {
  if (compiler.options.output.library !== undefined && compiler.options.output.library !== false) {
    throw new TypeError(
      `imgfmt/${framework} requires an HTML application build; use imgfmt/postcss for CSS libraries`,
    );
  }

  if (!isDocumentTarget(compiler.options.target)) {
    throw new TypeError(
      `imgfmt/${framework} supports document/client builds only; remove it from server and worker compilers`,
    );
  }
}

function isDocumentTarget(target: unknown): boolean {
  if (target === undefined) {
    return true;
  }

  const targets = Array.isArray(target) ? target : [target];
  let hasDocumentTarget = false;

  for (const item of targets) {
    if (typeof item !== "string") {
      return false;
    }

    if (
      item === "web" ||
      item === "browserslist" ||
      item.startsWith("browserslist:") ||
      /^electron(?:\d+(?:\.\d+)*)?-renderer$/.test(item)
    ) {
      hasDocumentTarget = true;
      continue;
    }

    if (/^es\d+$/.test(item)) {
      continue;
    }

    return false;
  }

  return hasDocumentTarget;
}

function findHtmlPluginApis(
  compiler: WebpackLikeCompiler,
  framework: Framework,
): readonly HtmlPluginApi[] {
  if (framework === "rspack") {
    const api = compiler.rspack?.HtmlRspackPlugin;

    if (api === undefined) {
      return [];
    }

    return compiler.options.plugins.some((plugin) => getPluginConstructor(plugin) === api)
      ? [api]
      : [];
  }

  const apis = new Set<HtmlPluginApi>();

  for (const plugin of compiler.options.plugins) {
    const constructor = getPluginConstructor(plugin);

    if (constructor?.name === "HtmlWebpackPlugin") {
      apis.add(constructor);
    }
  }

  return [...apis];
}

function getPluginConstructor(
  plugin: unknown,
): (HtmlPluginApi & { readonly name: string }) | undefined {
  if ((typeof plugin !== "object" || plugin === null) && typeof plugin !== "function") {
    return undefined;
  }

  const constructor = (plugin as { readonly constructor?: unknown }).constructor;

  if (
    typeof constructor !== "function" ||
    !("getCompilationHooks" in constructor) ||
    typeof constructor.getCompilationHooks !== "function"
  ) {
    return undefined;
  }

  return constructor as unknown as HtmlPluginApi & { readonly name: string };
}

function setExpectedRuntimeUrl(
  expectedRuntimeUrls: Map<string, string>,
  outputName: string,
  runtimeUrl: string,
): void {
  if (expectedRuntimeUrls.has(outputName)) {
    throw new Error(`imgfmt already prepared a runtime URL for ${outputName}`);
  }

  expectedRuntimeUrls.set(outputName, runtimeUrl);
}

function getExpectedRuntimeUrl(
  expectedRuntimeUrls: Map<string, string>,
  outputName: string,
): string {
  const runtimeUrl = expectedRuntimeUrls.get(outputName);

  if (runtimeUrl === undefined) {
    throw new Error(`imgfmt could not resolve the runtime URL for ${outputName}`);
  }

  return runtimeUrl;
}

function isRuntimeTag(tag: HtmlTag, runtimeUrl: string): boolean {
  return (
    tag.tagName.toLowerCase() === "script" &&
    tag.attributes.src === runtimeUrl &&
    tag.attributes[runtimeMarkerAttribute] === true
  );
}
