import { defineConfig } from "vite-official";

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
  worker: {
    format: "es",
    rolldownOptions: {
      output: {
        keepNames: true,
      },
    },
  },
});
