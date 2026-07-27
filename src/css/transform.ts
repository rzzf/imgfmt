import postcss from "postcss";

import { createPostcssPlugin } from ".";
import type { ImgfmtOptions } from "../types";
import type { ProcessCssModuleOptions } from "./types";

export type { ProcessCssModuleOptions } from "./types";

/** Runs imgfmt's CSS compiler for a bundler-owned CSS module. */
export async function processCssModule(
  source: string,
  id: string,
  inputOptions: ImgfmtOptions = {},
  options: ProcessCssModuleOptions = {},
): Promise<string> {
  const result = await postcss([createPostcssPlugin(inputOptions, options)]).process(source, {
    from: id,
    map: false,
    to: id,
  });

  return result.css;
}

/** Matches ordinary and query-qualified CSS module identifiers. */
export function isCssModuleId(id: string): boolean {
  const moduleId = id.startsWith("\0") ? id.slice(1) : id;
  const cleanId = moduleId.split(/[?#]/, 1)[0];
  return cleanId?.toLowerCase().endsWith(".css") === true;
}
