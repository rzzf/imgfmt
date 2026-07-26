import { defineConfig } from "vite-plus";

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
    include: ["packages/*/test/**/*.test.ts"],
  },
  pack: {
    format: "esm",
    platform: "neutral",
    sourcemap: false,
    dts: true,
    clean: true,
    deps: {
      neverBundle: true,
    },
  },
});
