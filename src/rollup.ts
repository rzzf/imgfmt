import imgfmt from "./unplugin";

const rollup: typeof imgfmt.rollup = imgfmt.rollup;

export default rollup;
export { rollup as "module.exports" };
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
