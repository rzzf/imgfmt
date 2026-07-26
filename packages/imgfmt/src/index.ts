import type { ImgfmtOptions } from "./types";

/** Type-check and share one option object across multiple imgfmt entry points. */
export function defineConfig(options: ImgfmtOptions = {}): ImgfmtOptions {
  return options;
}

export type {
  ImgfmtFormatOptions,
  ImgfmtImageProbe,
  ImgfmtOptions,
  ImgfmtVariantUrlRequest,
  ImgfmtVariantUrlResolver,
} from "./types";
