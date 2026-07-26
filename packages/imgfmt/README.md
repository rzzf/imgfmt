# imgfmt

Deliver user-provided AVIF, WebP and original background images through CSS while loading exactly one candidate for each managed image occurrence.

> imgfmt is experimental and has not been published yet.

## Installation

```sh
pnpm add -D imgfmt postcss
```

The default format order is AVIF, WebP, then the original URL:

```css
.hero {
  background-image: url("./hero.png");
}
```

Provide `hero.png`, `hero.avif` and `hero.webp` yourself. imgfmt does not create or optimize images; generated URLs remain in the host's normal CSS and asset pipeline.

## CSS contract

imgfmt processes direct, top-level, local `url()` occurrences in `background` and `background-image` declarations.

- The original rule is retained, but each managed local `url()` is replaced with `none`. The original-format URL moves into the final unsupported-format fallback rule.
- A generated declaration keeps the original property name. A `background` shorthand is reduced to `background-image`.
- Emitted image values are not decoded, re-encoded or normalized. Quotes, whitespace and surrounding URL syntax are preserved; only the filename suffix changes.
- URLs with any scheme, including `http:`, `https:` and `data:`, and protocol-relative URLs beginning with `//`, are left untouched.
- Non-URL resets, pure gradients and unrelated background declarations are not mirrored. A shorthand is not expanded into a complete background cascade.
- Nested URLs inside functions such as `image-set()` are outside the transformation boundary.

Query strings and fragments are preserved by the default sibling convention.

This local-only model has a deliberate cascade limit. Capability gates add selector specificity so the selected candidate overrides the retained original declaration in older browsers. A later, lower-specificity `background: none`, `background-image: none` or `all` reset is not mirrored and may therefore fail to override the generated candidate. Stylesheets that depend on those cross-rule resets are outside the current transformation boundary.

## Vite and Vue

```ts
// vite.config.ts
import { defineConfig } from "vite";
import imgfmt from "imgfmt/vite";

export default defineConfig({
  plugins: [imgfmt()],
});
```

Vue projects built with Vite use the same configuration. Vite browser applications must have an HTML entry; library, SSR and worker builds are rejected.

When Vite loads an external PostCSS config, share one manual option object:

```ts
// imgfmt.config.ts
import { defineConfig } from "imgfmt";

export default defineConfig({ postcss: "manual" });
```

```ts
// postcss.config.ts
import imgfmt from "imgfmt/postcss";
import options from "./imgfmt.config";

export default { plugins: [imgfmt(options)] };
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import imgfmt from "imgfmt/vite";
import options from "./imgfmt.config";

export default defineConfig({ plugins: [imgfmt(options)] });
```

## PostCSS

```ts
// postcss.config.ts
import imgfmt from "imgfmt/postcss";

export default { plugins: [imgfmt()] };
```

This entry only compiles CSS. Pair it with a host adapter using the same options so the application document receives the pending state and runtime. Run it after import, nesting and preprocessor plugins. Standalone unresolved `@import` rules are rejected.

## Rollup

```ts
// rollup.config.ts
import html from "@rollup/plugin-html";
import imgfmt from "imgfmt/rollup";
import css from "rollup-plugin-postcss";

export default {
  input: "src/main.ts",
  output: { dir: "dist", format: "es" },
  plugins: [imgfmt(), css({ extract: true }), html()],
};
```

Keep a CSS extractor after imgfmt and emit at least one `.html` asset. The adapter transforms source CSS, not final bundle CSS; the downstream CSS plugin remains responsible for extraction and asset URL handling. For a host-owned PostCSS pipeline, use `imgfmt/postcss` there and pass `{ postcss: "manual" }` to `imgfmt/rollup`.

## Rolldown

```ts
// rolldown.config.ts
import html from "@rollup/plugin-html";
import imgfmt from "imgfmt/rolldown";
import css from "rollup-plugin-postcss";

export default {
  input: "src/main.ts",
  output: { dir: "dist", format: "es" },
  plugins: [imgfmt(), css({ extract: true }), html()],
};
```

Rolldown has the same contract: a compatible downstream plugin must extract CSS, and an HTML plugin must emit the document. Manual PostCSS ownership works as it does for Rollup.

## webpack

```ts
// webpack.config.ts
import HtmlWebpackPlugin from "html-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import { defineConfig } from "imgfmt";
import imgfmtPostcss from "imgfmt/postcss";
import imgfmt from "imgfmt/webpack";

const options = defineConfig({ postcss: "manual" });

export default {
  entry: "./src/main.ts",
  target: "web",
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [
          MiniCssExtractPlugin.loader,
          { loader: "css-loader", options: { importLoaders: 1 } },
          {
            loader: "postcss-loader",
            options: {
              postcssOptions: { plugins: [imgfmtPostcss(options)] },
            },
          },
        ],
      },
      { test: /\.(?:avif|png|webp)$/i, type: "asset/resource" },
    ],
  },
  plugins: [new HtmlWebpackPlugin(), new MiniCssExtractPlugin(), imgfmt(options)],
};
```

webpack always requires `postcss: "manual"`, `imgfmt/postcss` in the owning loader chain, `HtmlWebpackPlugin` and a document target. The webpack adapter itself only owns HTML and runtime delivery.

## Rspack

```ts
// rspack.config.ts
import { rspack } from "@rspack/core";
import { defineConfig } from "imgfmt";
import imgfmtPostcss from "imgfmt/postcss";
import imgfmt from "imgfmt/rspack";

const options = defineConfig({ postcss: "manual" });

export default {
  entry: "./src/main.ts",
  target: "web",
  module: {
    rules: [
      {
        test: /\.css$/i,
        type: "css/auto",
        use: [
          {
            loader: "postcss-loader",
            options: {
              postcssOptions: { plugins: [imgfmtPostcss(options)] },
            },
          },
        ],
      },
      { test: /\.(?:avif|png|webp)$/i, type: "asset/resource" },
    ],
  },
  plugins: [new rspack.HtmlRspackPlugin(), imgfmt(options)],
};
```

Rspack likewise requires manual PostCSS ownership, `rspack.HtmlRspackPlugin` and a document target. Server, worker and library builds are unsupported.

## esbuild

esbuild requires explicit document ownership. Static mode writes transformed HTML under `outdir`:

```ts
// build.ts
import { build } from "esbuild";
import imgfmt from "imgfmt/esbuild";

await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints: ["src/main.ts"],
  outdir: "dist",
  loader: {
    ".avif": "file",
    ".png": "file",
    ".webp": "file",
  },
  plugins: [
    imgfmt({
      document: {
        mode: "static",
        files: [{ input: "index.html", output: "index.html" }],
      },
    }),
  ],
});
```

Manual mode hands document installation to another integration and supports `write: false`:

```ts
import imgfmt from "imgfmt/esbuild";

const plugin = imgfmt({
  document: {
    mode: "manual",
    onManifest(manifest) {
      const html = manifest.install(sourceHtml, "pages/index.html");
      const runtimeUrl = manifest.runtimeUrlFor("pages/index.html");
      // Pass `html` and `runtimeUrl` to the document owner.
    },
    watchFiles: ["index.html"],
  },
});
```

Both modes require `bundle: true`, a browser build, a real application entry and `outdir`. When imgfmt owns HTML, esbuild `publicPath` must be absolute, root-relative or `./`; nested documents resolve `./` relative to their output location. esbuild automatically transforms filesystem `.css` and `.module.css` inputs. If another plugin owns CSS loading, use `imgfmt/postcss` there and set `postcss: "manual"`.

## Runtime and scope

Host adapters install `data-imgcaps="pending"` before styles are evaluated and add a small external classic script with `async`. Managed URLs in retained source rules are already `none`, so no managed candidate is exposed while probing. The script runs `new Image()` probes concurrently, waits until all probes settle or the deadline is reached, then commits one complete capability state. CSS selects one AVIF, WebP or original URL for that state without `image-set()`, CSS custom properties, Modernizr, modules or native `Promise`.

imgfmt only delivers CSS and this runtime. It does not read, download, decode, encode, convert, compress, optimize, emit or validate image bytes. Users or a separate image pipeline provide every format variant.

See the [repository](https://github.com/rzzf/imgfmt) for development instructions.

## License

[MIT](LICENSE)
