import imgfmt from "./unplugin";

const vite: typeof imgfmt.vite = imgfmt.vite;

export default vite;
export { vite as "module.exports" };
export type {
  ImgfmtFormatOptions,
  ImgfmtImageProbe,
  ImgfmtOptions,
  ImgfmtVariantUrlRequest,
  ImgfmtVariantUrlResolver,
} from "./types";
