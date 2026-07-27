import imgfmt from "./unplugin";

const esbuild: typeof imgfmt.esbuild = imgfmt.esbuild;

export default esbuild;
export { esbuild as "module.exports" };
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
