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

Provide every referenced file yourself:

```text
hero.png
hero.avif
hero.webp
```

imgfmt does not create or optimize images. Its build adapters keep generated URLs in the host's normal CSS and asset pipeline.

## CSS contract

imgfmt processes direct, top-level, local `url()` occurrences in `background` and `background-image` declarations.

- The original rule is retained, but each managed local `url()` is replaced with `none`. The original-format URL moves into the final unsupported-format fallback rule.
- A generated declaration keeps the original property name. A `background` shorthand is reduced to the smallest affected property, `background-image`.
- The emitted image value is not decoded, re-encoded or normalized. Quotes, whitespace and the surrounding URL syntax are preserved; only the filename suffix changes.
- URLs with a scheme, including `http:`, `https:` and `data:`, and protocol-relative URLs beginning with `//`, are left untouched.
- Non-URL resets, pure gradients and unrelated background declarations are not mirrored. imgfmt does not expand a shorthand into a complete background cascade.
- Nested URLs inside functions such as `image-set()` are outside the transformation boundary.

The default sibling convention preserves query strings and fragments. For example, `url( "./hero.png?x=1#top" )` becomes `url( "./hero.avif?x=1#top" )` without changing its original formatting.

This local-only model has a deliberate cascade limit. Capability gates add selector specificity so that a selected candidate overrides the retained original declaration in older browsers. A later, lower-specificity `background: none`, `background-image: none` or `all` reset is not mirrored and therefore may not override that generated candidate. Stylesheets that rely on those cross-rule resets are outside the current transformation boundary.

## Vite and Vue

```ts
// vite.config.ts
import { defineConfig } from "vite";
import imgfmt from "imgfmt/vite";

export default defineConfig({
  plugins: [imgfmt()],
});
```

Vue projects built with Vite use the same configuration. The adapter transforms CSS, adds the pending document state and serves or emits the asynchronous capability runtime. It supports browser applications with at least one HTML entry; it rejects library, SSR and worker builds.

If Vite loads an external `postcss.config.*`, install the PostCSS entry there and select manual mode with one shared option object:

```ts
// imgfmt.config.ts
import { defineConfig } from "imgfmt";

export default defineConfig({ postcss: "manual" });
```

```ts
// postcss.config.ts
import imgfmt from "imgfmt/postcss";
import options from "./imgfmt.config";

export default {
  plugins: [imgfmt(options)],
};
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import imgfmt from "imgfmt/vite";
import options from "./imgfmt.config";

export default defineConfig({
  plugins: [imgfmt(options)],
});
```

Run `imgfmt/postcss` after plugins that resolve imports, nesting or preprocessors.

## PostCSS

```ts
// postcss.config.ts
import imgfmt from "imgfmt/postcss";

export default {
  plugins: [imgfmt()],
};
```

The PostCSS entry only compiles CSS. It does not modify HTML or install the runtime, so an application must also use a host adapter with the same options. Standalone CSS libraries may compile with this entry, but the consuming document owns runtime integration. Unresolved `@import` rules are rejected because imgfmt must see every participating stylesheet.

## Rollup

Place imgfmt before the CSS extraction plugin and use an HTML plugin that emits an `.html` asset:

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

The Rollup adapter transforms source CSS before extraction, then adds the pending state and runtime to emitted HTML. It deliberately does not rewrite final CSS assets in `generateBundle`, where asset URL handling would already be complete. Your downstream CSS plugin must extract CSS and handle or preserve its asset URLs. A build with no emitted HTML fails closed.

If another PostCSS pipeline owns the source, add `imgfmt/postcss` there and pass `{ postcss: "manual" }` to `imgfmt/rollup`.

## Rolldown

Rolldown uses the same ordering contract:

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

Rolldown does not provide the CSS extraction step for imgfmt. Keep a compatible CSS extractor after imgfmt and ensure an HTML plugin emits the document. Manual PostCSS ownership works in the same way as Rollup.

## webpack

webpack requires explicit PostCSS ownership and `HtmlWebpackPlugin`:

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
      {
        test: /\.(?:avif|png|webp)$/i,
        type: "asset/resource",
      },
    ],
  },
  plugins: [new HtmlWebpackPlugin(), new MiniCssExtractPlugin(), imgfmt(options)],
};
```

Keep `imgfmt/postcss` in the loader chain that owns the final source CSS. The webpack adapter only owns HTML and runtime delivery; it rejects automatic PostCSS mode, non-document targets, library builds and configurations without `HtmlWebpackPlugin`.

## Rspack

Rspack also requires manual PostCSS ownership and `rspack.HtmlRspackPlugin`:

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
      {
        test: /\.(?:avif|png|webp)$/i,
        type: "asset/resource",
      },
    ],
  },
  plugins: [new rspack.HtmlRspackPlugin(), imgfmt(options)],
};
```

The Rspack adapter has the same boundary as webpack: the host CSS pipeline runs `imgfmt/postcss`, while the adapter installs the document state and runtime. Server, worker and library builds are unsupported.

## esbuild

esbuild has no HTML lifecycle, so document ownership is required. Static mode reads source HTML and writes transformed copies under `outdir`:

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

Manual mode delegates the HTML write to another integration:

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

Manual mode also supports `write: false`. Both modes require `bundle: true`, a browser build, at least one application entry and `outdir` rather than `outfile`. When imgfmt owns HTML, esbuild `publicPath` must be absolute, root-relative or `./`; nested documents resolve `./` relative to their output location. esbuild transforms filesystem `.css` and `.module.css` inputs automatically. If another plugin owns CSS loading, install `imgfmt/postcss` in that pipeline and set `postcss: "manual"`.

## Runtime and exact-one delivery

Each host adapter installs `data-imgcaps="pending"` before styles are evaluated and adds a small external classic script with `async`. Managed URLs in the retained source rule are already `none`, so no managed candidate is exposed while probing. The script runs `new Image()` probes concurrently and commits one complete capability state only after all probes settle or the deadline is reached. Generated selectors then choose AVIF, WebP or the original URL for that final state.

This does not depend on `image-set()`, CSS custom properties, Modernizr, JavaScript modules or native `Promise`. If the runtime or probe data URLs are blocked by CSP, managed backgrounds remain in the pending `none` state rather than requesting several candidates.

## Scope

imgfmt delivers CSS and the browser capability runtime. It does not read, download, decode, encode, convert, compress, optimize, emit or validate image bytes. Users or a separate image pipeline must provide every same-name format variant.

## Development

The repository uses Node.js 24, pnpm 11, TypeScript 6 and Vite+. Shared dependency versions use pnpm catalogs.

```sh
vp install
vp check
vp test --run
vp run -r build
```

Tests live in `packages/imgfmt/test`.

## License

[MIT](LICENSE)
