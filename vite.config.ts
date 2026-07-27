import { defineConfig } from "vite-plus";

const entries = [
  "src/index.ts",
  "src/postcss.ts",
  "src/parcel.ts",
  "src/vite.ts",
  "src/rollup.ts",
  "src/rolldown.ts",
  "src/webpack.ts",
  "src/rspack.ts",
  "src/esbuild.ts",
];

export default defineConfig({
  lint: {
    plugins: ["typescript", "unicorn", "oxc"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: ["**/dist/**", "**/coverage/**", "**/.parcel-cache/**"],
  },
  fmt: {
    printWidth: 100,
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    proseWrap: "preserve",
    sortImports: true,
    ignorePatterns: ["**/dist/**", "**/coverage/**", "**/.parcel-cache/**"],
  },
  test: {
    include: ["test/**/*.test.ts", "playground/test/**/*.test.ts"],
  },
  pack: [
    {
      entry: entries,
      format: "esm",
      platform: "neutral",
      sourcemap: false,
      dts: true,
      clean: true,
      deps: {
        neverBundle: true,
      },
    },
    {
      entry: entries,
      format: "cjs",
      platform: "node",
      target: "node18",
      sourcemap: false,
      dts: false,
      clean: false,
      outputOptions: {
        exports: "named",
      },
      deps: {
        neverBundle: true,
      },
    },
  ],
});
