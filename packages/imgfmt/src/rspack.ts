import imgfmt, { assertHostOwnsDocument } from "./unplugin";

const rspack: typeof imgfmt.rspack = (options) => {
  assertHostOwnsDocument(options, "rspack");
  return imgfmt.rspack(options);
};

export default rspack;
export { rspack as "module.exports" };
export type {
  ImgfmtDocumentFile,
  ImgfmtDocumentIntegration,
  ImgfmtDocumentManifest,
  ImgfmtFormatOptions,
  ImgfmtImageProbe,
  ImgfmtOptions,
  ImgfmtVariantUrlRequest,
  ImgfmtVariantUrlResolver,
} from "./types";
