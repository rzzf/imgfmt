import type { ImgfmtOptions } from "./types";

/** Type-check and share one option object across multiple imgfmt entry points. */
export function defineConfig(options: ImgfmtOptions = {}): ImgfmtOptions {
  return options;
}

export type {
  ImgfmtDocumentFile,
  ImgfmtDocumentIntegration,
  ImgfmtDocumentManifest,
  ImgfmtFormatOptions,
  ImgfmtImageProbe,
  ImgfmtManualDocumentIntegration,
  ImgfmtOptions,
  ImgfmtParcelOptions,
  ImgfmtStaticDocumentIntegration,
  ImgfmtVariantUrlRequest,
  ImgfmtVariantUrlResolver,
} from "./types";
