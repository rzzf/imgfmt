import imgfmt from "./unplugin";

const rolldown: typeof imgfmt.rolldown = imgfmt.rolldown;

export default rolldown;
export { rolldown as "module.exports" };
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
