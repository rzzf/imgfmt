import type { RspackCompiler, WebpackCompiler } from "unplugin";

import type { ImgfmtOptions } from "../types";
import { injectDocumentBootstrap } from "./document";

const pluginName = "imgfmt";
const installedCompilers = new WeakSet<object>();

type Framework = "rspack" | "webpack";

export interface InstallWebpackRuntimeOptions {
  readonly compiler: RspackCompiler | WebpackCompiler;
  readonly framework: Framework;
  readonly postcss: ImgfmtOptions["postcss"];
  readonly runtimeSource: string;
}

interface CompilationConstructor {
  readonly PROCESS_ASSETS_STAGE_REPORT: number;
}

interface ProcessAssetsHook {
  tap(options: { readonly name: string; readonly stage: number }, handler: () => void): void;
}

interface CompilationLike {
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

interface BeforeEmitData extends HtmlPluginData {
  html: string;
}

interface HtmlPluginHooks {
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

  const hookName = `${pluginName}/${options.framework}`;

  compiler.hooks.thisCompilation.tap(hookName, (compilation) => {
    const processedHtmlOutputs = new Set<string>();
    const installedHookSets = new Set<HtmlPluginHooks>();

    for (const htmlPluginApi of htmlPluginApis) {
      const hooks = htmlPluginApi.getCompilationHooks(compilation);

      if (installedHookSets.has(hooks)) {
        continue;
      }

      installedHookSets.add(hooks);
      installHtmlHooks(hooks, hookName, options.runtimeSource, processedHtmlOutputs);
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
  runtimeSource: string,
  processedHtmlOutputs: Set<string>,
): void {
  hooks.beforeEmit.tapPromise(hookName, async (data) => {
    data.html = injectDocumentBootstrap(data.html, runtimeSource);
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
