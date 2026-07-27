import { createUnplugin, type UnpluginFactory, type UnpluginInstance } from "unplugin";

import { normalizeOptions } from "./core/options";
import { generateRuntimeSource } from "./runtime";
import { setupEsbuild } from "./runtime/esbuild";
import { createRolldownHooks, createRollupHooks } from "./runtime/rollup";
import { createViteHooks } from "./runtime/vite";
import { installWebpackRuntime } from "./runtime/webpack";
import type { ImgfmtOptions } from "./types";

const pluginName = "imgfmt";

export const unpluginFactory: UnpluginFactory<ImgfmtOptions | undefined, false> = (
  inputOptions,
  meta,
) => {
  switch (meta.framework) {
    case "vite":
      return {
        enforce: "post",
        name: pluginName,
        vite: createViteHooks(inputOptions, createRuntimeSource(inputOptions)),
      };
    case "rollup":
      return {
        name: pluginName,
        rollup: createRollupHooks(inputOptions),
      };
    case "rolldown":
      return {
        name: pluginName,
        rolldown: createRolldownHooks(inputOptions),
      };
    case "webpack":
      assertHostOwnsDocument(inputOptions, "webpack");
      return {
        name: pluginName,
        webpack(compiler): void {
          installWebpackRuntime({
            compiler,
            framework: "webpack",
            postcss: inputOptions?.postcss,
            runtimeSource: createRuntimeSource(inputOptions),
          });
        },
      };
    case "rspack":
      assertHostOwnsDocument(inputOptions, "rspack");
      return {
        name: pluginName,
        rspack(compiler): void {
          installWebpackRuntime({
            compiler,
            framework: "rspack",
            postcss: inputOptions?.postcss,
            runtimeSource: createRuntimeSource(inputOptions),
          });
        },
      };
    case "esbuild":
      return {
        name: pluginName,
        esbuild: {
          setup(build): void {
            setupEsbuild(build, inputOptions);
          },
        },
      };
    default:
      return { name: pluginName };
  }
};

const imgfmt: UnpluginInstance<ImgfmtOptions | undefined, false> = createUnplugin(unpluginFactory);

export default imgfmt;

function createRuntimeSource(inputOptions: ImgfmtOptions | undefined): string {
  const options = normalizeOptions(inputOptions);
  return generateRuntimeSource({
    deadlineMs: options.probeDeadlineMs,
    formats: options.formats,
  });
}

export function assertHostOwnsDocument(
  inputOptions: ImgfmtOptions | undefined,
  framework: "rspack" | "webpack",
): void {
  if (inputOptions?.document !== undefined) {
    throw new TypeError(`imgfmt/${framework} owns emitted HTML; remove the document option`);
  }
}
