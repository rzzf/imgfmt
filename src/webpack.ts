import imgfmt, { assertHostOwnsDocument } from "./unplugin";

const webpack: typeof imgfmt.webpack = (options) => {
  assertHostOwnsDocument(options, "webpack");
  return imgfmt.webpack(options);
};

export default webpack;
export { webpack as "module.exports" };
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
