import vue from "@vitejs/plugin-vue";
import imgfmt from "imgfmt/vite";
import { defineConfig, type Plugin } from "vite";

export default defineConfig({
  base: "./",
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [vue(), imgfmt() as unknown as Plugin],
});
