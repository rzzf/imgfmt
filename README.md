# imgfmt

Format-aware CSS image delivery for AVIF, WebP and your original assets.

[Playground](https://rzzf.github.io/imgfmt/) ·
[Vue 3 + Vite Example](examples/vue3-vite) ·
[License](LICENSE)

> [!NOTE]
> imgfmt is currently pre-1.0. Public APIs may evolve as browser and build-tool coverage expands.

Write ordinary CSS, provide the image variants, and let imgfmt generate the capability-gated
styles and browser runtime needed to select one candidate for each managed image occurrence.

```css
.banner {
  background-image: url("./banner.png");
}
```

```text
banner.png
banner.webp
banner.avif
```

imgfmt does not convert, optimize or emit those images. Your existing build tool continues to own
URL resolution, dependency tracking, hashing and asset output.

## Features

- **Use normal CSS** — keep authoring `url("./image.png")`; no `image-set()`, CSS variables or
  JavaScript imports are required.
- **AVIF → WebP → original fallback** — the default preference uses AVIF when supported, then
  WebP, then the URL you wrote.
- **One capability decision** — all browser probes settle behind one barrier before a single root
  attribute update exposes the selected CSS.
- **Multiple CSS image properties** — supports backgrounds, standard/WebKit masks and cursor
  images.
- **Universal build integrations** — Vite, Rollup, Rolldown, Parcel, webpack, Rspack, esbuild and
  standalone PostCSS entries are included.
- **Host-native assets** — generated URLs stay in the bundler's normal CSS pipeline.
- **Custom formats and URLs** — configure browser probes, filename extensions and synchronous or
  asynchronous URL resolution.
- **Small classic runtime** — one inline, ES5-compatible capability script runs at the start of
  `<head>`.
- **TypeScript first** — every entry and public option is typed.

## Where imgfmt Fits

imgfmt is a delivery plugin, not an image processor:

```text
your image pipeline                 imgfmt                     your build tool
───────────────────                 ──────                     ───────────────
banner.png ─┬─→ banner.webp      CSS url("./banner.png")      resolve, hash and emit assets
            └─→ banner.avif        + capability runtime        build the final HTML and CSS
```

Use any encoder, optimizer, CDN or asset workflow to create the files. imgfmt only maps their URL
strings into ready-state CSS and detects which configured formats the browser can decode. It never
opens application image files or adds an image-processing cache.

## Quick Start

### 1. Install

```sh
pnpm add -D imgfmt postcss
```

imgfmt publishes ESM and CommonJS entry points and requires Node.js `>=24.15.0` at build time.

### 2. Provide the image files

The default resolver changes only the filename extension:

```text
src/assets/banner.png
src/assets/banner.webp
src/assets/banner.avif
```

Queries and fragments are preserved, so `banner.png?theme=dark#cover` maps to
`banner.webp?theme=dark#cover` and `banner.avif?theme=dark#cover`.

### 3. Add the build plugin

Vite owns both the CSS and HTML integration automatically:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import imgfmt from "imgfmt/vite";

export default defineConfig({
  plugins: [imgfmt()],
});
```

Vue projects use the same Vite configuration. Vue SFC styles pass through Vite's existing CSS
pipeline; there is no separate Vue adapter.

### 4. Write normal CSS

```css
.banner {
  background:
    linear-gradient(#0004, #0004),
    url("./assets/banner.png") center / cover no-repeat;
}
```

imgfmt generates ready-state image declarations for the original, WebP and AVIF candidates while
suppressing the managed source URL during capability detection:

```css
:root[data-imgcaps~="ready"] .banner {
  background-image: linear-gradient(#0004, #0004), url("./assets/banner.png");
}

:root[data-imgcaps~="ready"][data-imgcaps~="webp"] .banner {
  background-image: linear-gradient(#0004, #0004), url("./assets/banner.webp");
}

:root[data-imgcaps~="ready"][data-imgcaps~="avif"] .banner {
  background-image: linear-gradient(#0004, #0004), url("./assets/banner.avif");
}

.banner {
  background:
    linear-gradient(#0004, #0004),
    none center / cover no-repeat;
}
```

The generated shorthand example intentionally copies only its image layers into
`background-image`; position, size and repeat remain in the author rule.

## Playground and Example

Try the real compiler in the [online playground](https://rzzf.github.io/imgfmt/). It accepts CSS,
Sass (SCSS), Less and Vue SFC input, shows the transformed CSS, and provides configuration examples
for every supported build tool.

The playground source is included in [`playground/`](playground) and can also run locally:

```sh
pnpm install
pnpm play
```

The repository also contains a runnable [Vue 3 + Vite example](examples/vue3-vite) that shows the
live `data-imgcaps` state and the selected PNG, WebP or AVIF background:

```sh
pnpm example
```

## How It Works

At build time:

```text
author CSS
  → find supported local raster url() occurrences
  → resolve caller-provided format variants
  → generate positive capability selectors
  → return every URL to the host's native CSS asset pipeline
```

In the browser:

```text
data-imgcaps="pending"
  → start all configured Image probes concurrently
  → wait for load, error, abort or the shared deadline
  → commit one complete capability state
  → matching ready selectors expose one candidate per managed occurrence
```

With the default AVIF/WebP registry:

| Browser result       | Root state        | Preferred candidate |
| -------------------- | ----------------- | ------------------- |
| AVIF and WebP        | `ready avif webp` | AVIF                |
| AVIF only            | `ready avif`      | AVIF                |
| WebP only            | `ready webp`      | WebP                |
| Neither format       | `ready`           | Original URL        |
| Runtime not executed | `pending`         | None                |

The runtime writes the root attribute once. It never publishes intermediate states such as WebP
followed by AVIF, which prevents those state transitions from exposing multiple managed
candidates.

## Supported CSS

imgfmt manages direct, top-level, local `url()` occurrences in these declarations:

| Author property      | Generated ready property | Pending source behavior        |
| -------------------- | ------------------------ | ------------------------------ |
| `background-image`   | `background-image`       | Managed `url()` becomes `none` |
| `background`         | `background-image`       | Managed `url()` becomes `none` |
| `mask-image`         | `mask-image`             | Managed `url()` becomes `none` |
| `mask`               | `mask-image`             | Managed `url()` becomes `none` |
| `-webkit-mask-image` | `-webkit-mask-image`     | Managed `url()` becomes `none` |
| `-webkit-mask`       | `-webkit-mask-image`     | Managed `url()` becomes `none` |
| `cursor`             | `cursor`                 | Managed declaration is removed |

`cursor` is removed rather than changed to `none` because values such as
`cursor: url("./pointer.png") 4 5, pointer` cannot be safely reduced to a universal placeholder.
Its complete syntax is restored in ready rules.

### Eligible source URLs

The source URL must end in one of these extensions, matched case-insensitively before query or
fragment text:

```text
.apng  .avif  .bmp  .gif  .ico  .jfif  .jpeg  .jpg  .png  .webp
```

SVG, TIFF, fonts, extensionless paths and unknown extensions are left untouched. URLs beginning
with a URI scheme such as `https:`, `data:` or `blob:`, and protocol-relative URLs beginning with
`//`, are also skipped before resolver calls.

imgfmt preserves raw URL quoting, escaping and whitespace. Nested URLs inside functions such as
`image-set()` are outside the transformation boundary.

## Build Tool Support

| Entry             | CSS ownership                              | HTML/runtime ownership               |
| ----------------- | ------------------------------------------ | ------------------------------------ |
| `imgfmt/vite`     | Automatic or manual PostCSS                | Vite HTML in development and build   |
| `imgfmt/rollup`   | Automatic source CSS or manual PostCSS     | Emitted HTML asset                   |
| `imgfmt/rolldown` | Automatic source CSS or manual PostCSS     | Emitted HTML asset                   |
| `imgfmt/parcel`   | Parcel PostCSS, after earlier plugins      | Parcel PostHTML                      |
| `imgfmt/webpack`  | Manual PostCSS required                    | HtmlWebpackPlugin                    |
| `imgfmt/rspack`   | Manual PostCSS required                    | HtmlRspackPlugin                     |
| `imgfmt/esbuild`  | Automatic filesystem CSS or manual PostCSS | Explicit static/manual document mode |
| `imgfmt/postcss`  | CSS only                                   | None                                 |

The peer ranges track the oldest host APIs used by each adapter, while development and CI continue
to exercise the current catalog versions:

| Host                   | Supported versions                      |
| ---------------------- | --------------------------------------- |
| Vite                   | 4.x, 5.x, 6.x, 7.x and 8.x              |
| Rollup                 | 2.78.0+, 3.x and 4.x                    |
| Rolldown               | 1.x                                     |
| Parcel                 | 2.x                                     |
| webpack                | 5.20.0+ within 5.x                      |
| HtmlWebpackPlugin      | 5.6.1+ within 5.x                       |
| Rspack                 | 1.1.0+ and 2.x                          |
| esbuild                | 0.18.14 through the current pre-1.0 API |
| PostCSS                | 8.4.31+ within 8.x                      |
| PostHTML (Parcel only) | 0.16.5+ within 0.16.x                   |

<details>
<summary>Vite</summary>

```ts
// vite.config.ts
import { defineConfig } from "vite";
import imgfmt from "imgfmt/vite";

export default defineConfig({
  plugins: [imgfmt()],
});
```

Vite browser applications are supported. Library, SSR, worker and JavaScript-only builds do not
own a suitable HTML document and are rejected.

If Vite discovers an external `postcss.config.*`, install `imgfmt/postcss` in that file and set
`postcss: "manual"` on one shared options object:

```ts
// imgfmt.config.ts
import { defineConfig } from "imgfmt";

export default defineConfig({
  postcss: "manual",
});
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

</details>

<details>
<summary>Rollup</summary>

Place imgfmt before the CSS extraction plugin and include an HTML plugin:

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

imgfmt transforms source CSS but does not provide CSS extraction. At least one HTML asset must be
emitted so the adapter can install the pending state and inline runtime.

</details>

<details>
<summary>Rolldown</summary>

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

</details>

<details>
<summary>Parcel</summary>

Parcel loads `imgfmt/parcel` through its existing PostCSS and PostHTML transformers. Install
PostHTML alongside the normal dependencies:

```sh
pnpm add -D imgfmt parcel postcss posthtml
```

Add imgfmt after PurgeCSS and other PostCSS plugins. The Parcel entry runs its CSS compiler during
`OnceExit`, so rules generated by imgfmt cannot be removed by an earlier PurgeCSS `OnceExit` hook:

```json
// .postcssrc
{
  "plugins": {
    "@fullhuman/postcss-purgecss": {},
    "imgfmt/parcel": {}
  }
}
```

Use the same entry in PostHTML to install `data-imgcaps="pending"` and the inline runtime:

```json
// .posthtmlrc
{
  "plugins": {
    "imgfmt/parcel": {}
  }
}
```

No `.parcelrc` override is required. If the project has a custom `.parcelrc`, keep Parcel's
PostCSS, CSS, PostHTML and HTML transformers in their normal order.

For non-default options, use one shared JavaScript object in both configs so CSS capability gates
and browser probes cannot diverge:

```js
// imgfmt.config.mjs
export default {
  formats: [{ id: "avif" }, { id: "webp" }],
  probeDeadlineMs: 500,
};
```

```js
// postcss.config.mjs
import purgecss from "@fullhuman/postcss-purgecss";
import imgfmt from "imgfmt/parcel";
import options from "./imgfmt.config.mjs";

export default {
  plugins: [purgecss(), imgfmt(options)],
};
```

```js
// posthtml.config.mjs
import imgfmt from "imgfmt/parcel";
import options from "./imgfmt.config.mjs";

export default {
  plugins: [imgfmt(options)],
};
```

Parcel warns that JavaScript PostCSS/PostHTML configs are invalidated on restart rather than
cached like JSON configs. Prefer the JSON form when using imgfmt defaults.

</details>

<details>
<summary>webpack</summary>

webpack requires `imgfmt/postcss` in its CSS loader chain and `HtmlWebpackPlugin` for document
ownership:

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

</details>

<details>
<summary>Rspack</summary>

Rspack requires manual PostCSS ownership and `rspack.HtmlRspackPlugin`:

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

</details>

<details>
<summary>esbuild</summary>

esbuild has no HTML lifecycle, so it requires explicit document ownership. Static mode reads source
HTML and writes the installed document under `outdir`:

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

Manual mode delegates HTML output to another integration:

```ts
import imgfmt from "imgfmt/esbuild";

const plugin = imgfmt({
  document: {
    mode: "manual",
    onManifest(manifest) {
      const html = manifest.install(sourceHtml);
      // Pass `html` to the document owner.
    },
    watchFiles: ["index.html"],
  },
});
```

Manual mode supports `write: false`. Both modes require `bundle: true`, a browser build, at least
one application entry and `outdir`.

</details>

<details>
<summary>PostCSS</summary>

```ts
// postcss.config.ts
import imgfmt from "imgfmt/postcss";

export default {
  plugins: [imgfmt()],
};
```

The standalone entry only transforms CSS. It does not modify HTML or install the capability
runtime, so applications must pair it with the matching host adapter and options. Unresolved
`@import` rules are rejected because imgfmt must see every participating stylesheet.

</details>

## Configuration

The JavaScript build-tool entries accept `ImgfmtOptions`. `defineConfig` returns a type-checked
object unchanged, which is useful when a host adapter and `imgfmt/postcss` share configuration:

```ts
// imgfmt.config.ts
import { defineConfig } from "imgfmt";

export default defineConfig({
  formats: [{ id: "avif" }, { id: "webp" }],
  probeDeadlineMs: 500,
  strict: true,
});
```

```ts
interface ImgfmtOptions {
  document?: ImgfmtDocumentIntegration;
  formats?: readonly ImgfmtFormatOptions[];
  postcss?: "auto" | "manual";
  probeDeadlineMs?: number;
  resolveVariantUrl?: ImgfmtVariantUrlResolver;
  strict?: boolean;
}
```

`imgfmt/parcel` accepts `ImgfmtParcelOptions`, which omits `document` and `postcss` because its
PostCSS and PostHTML config files already define both ownership boundaries:

```ts
type ImgfmtParcelOptions = Omit<ImgfmtOptions, "document" | "postcss">;
```

| Option              | Default                            | Description                                                                                           |
| ------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `formats`           | `[{ id: "avif" }, { id: "webp" }]` | Ordered output preference, filename extensions and browser probes.                                    |
| `probeDeadlineMs`   | `500`                              | Shared probe deadline from 1 through 60,000 milliseconds.                                             |
| `resolveVariantUrl` | Sibling filename resolver          | Maps one original URL and format to an opaque variant URL, synchronously or asynchronously.           |
| `strict`            | `true`                             | Resolver errors fail the build; `false` warns and treats only that variant as unavailable.            |
| `postcss`           | Host-dependent                     | Lets a capable adapter own CSS, or delegates it to caller-installed `imgfmt/postcss` with `"manual"`. |
| `document`          | None                               | Required only by esbuild; selects static or manual HTML ownership.                                    |

### Formats and probes

`formats` contains between one and four entries in preferred-candidate order. Supplying it replaces
the complete default registry.

```ts
interface ImgfmtFormatOptions {
  id: string;
  extension?: string;
  probes?: readonly ImgfmtImageProbe[];
}

interface ImgfmtImageProbe {
  uri: string;
  width: number;
  height: number;
}
```

- `id` becomes the lowercase capability token used in generated selectors. IDs must be unique.
- `extension` defaults to `.${id}`, must match `/^\.[a-z0-9][a-z0-9.-]*$/i`, and is used only by
  the default sibling resolver.
- `probes` contains images decoded with browser `Image` objects. Every probe for a format must load
  and match its expected dimensions. Probe URIs must be non-empty and dimensions must be positive
  safe integers.

AVIF and WebP have built-in 1×1 probes for baseline static AVIF and lossy static WebP. Supplying
`probes` replaces a built-in probe list. Custom formats require at least one probe:

```ts
const options = defineConfig({
  formats: [
    {
      id: "jxl",
      extension: ".jxl",
      probes: [
        {
          uri: "/capability-probes/jxl.jxl",
          width: 1,
          height: 1,
        },
      ],
    },
    { id: "webp" },
  ],
});
```

Format IDs must match `/^[a-z][a-z0-9-]*$/`, must not start with `no-`, and cannot use the reserved
tokens `constructor`, `original`, `pending`, `prototype` or `ready`.

All configured probes start concurrently and share one `probeDeadlineMs` deadline. A format is
supported only when every probe assigned to it succeeds.

### Custom URL resolution

Use `resolveVariantUrl` when variants do not follow the sibling-extension convention:

```ts
const options = defineConfig({
  async resolveVariantUrl({ format, importer, originalUrl }) {
    return await assetManifest.lookup({ format, importer, originalUrl });
  },
});
```

```ts
type ImgfmtVariantUrlResolver = (
  request: ImgfmtVariantUrlRequest,
) => string | undefined | Promise<string | undefined>;

interface ImgfmtVariantUrlRequest {
  originalUrl: string;
  format: string;
  extension: string;
  importer?: string;
  property?: string;
}
```

| Request field | Meaning                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `originalUrl` | Raw, undecoded text inside `url(...)`, without surrounding quotes.                             |
| `format`      | Configured format ID.                                                                          |
| `extension`   | Configured or default extension for that format.                                               |
| `importer`    | Host/PostCSS source identity when available.                                                   |
| `property`    | Original declaration property, such as `background`, `mask-image` or `cursor`, when available. |

Return a non-empty string to use that URL or `undefined` when the occurrence has no variant for the
requested format. The result is inserted without decoding or re-encoding, so custom resolvers are
responsible for returning text that is safe inside the existing quoted or unquoted `url(...)`.

All resolver jobs begin before imgfmt awaits them. CSS is materialized only after every job settles.
With `strict: false`, a rejected resolver call produces a PostCSS warning and makes only that
variant unavailable. Structural CSS errors remain fatal regardless of `strict`.

URI schemes, protocol-relative URLs and unsupported source extensions are filtered before resolver
calls.

### Manual PostCSS ownership

Set `postcss: "manual"` only when another CSS pipeline runs `imgfmt/postcss` with the same options:

| Entry                              | Automatic behavior                                 | Manual behavior                         |
| ---------------------------------- | -------------------------------------------------- | --------------------------------------- |
| `imgfmt/vite`                      | Appends to Vite's inline/default PostCSS pipeline. | Skips automatic CSS installation.       |
| `imgfmt/rollup`, `imgfmt/rolldown` | Transforms source CSS before extraction.           | Skips automatic CSS transformation.     |
| `imgfmt/webpack`, `imgfmt/rspack`  | Rejected.                                          | Required.                               |
| `imgfmt/esbuild`                   | Transforms filesystem CSS inputs.                  | Delegates CSS loading to the caller.    |
| `imgfmt/postcss`                   | Always transforms CSS.                             | Same behavior for shared configuration. |

`imgfmt/parcel` is configured directly in `.postcssrc` and `.posthtmlrc`; it does not accept the
`postcss` option.

### esbuild document ownership

`document` is required by `imgfmt/esbuild` and rejected by adapters that already own an HTML
lifecycle:

```ts
type ImgfmtDocumentIntegration =
  | {
      mode: "static";
      files: readonly (string | ImgfmtDocumentFile)[];
    }
  | {
      mode: "manual";
      onManifest: (manifest: ImgfmtDocumentManifest) => void | Promise<void>;
      watchFiles?: readonly string[];
    };

interface ImgfmtDocumentFile {
  input: string;
  output?: string;
}

interface ImgfmtDocumentManifest {
  install(html: string): string;
}
```

In static mode:

- `input` is absolute or relative to esbuild's build root and is watched for rebuilds.
- `output` defaults to the input basename and must be a unique relative `.html` path under
  `outdir`.
- imgfmt reads each input and atomically writes its installed document after a successful build.
- Static mode cannot be combined with `write: false`.

In manual mode, `onManifest` runs after every successful build. The caller owns reading and writing
HTML and calls `manifest.install(html)` to add the pending root state and inline runtime.
`watchFiles` adds caller-owned document paths to esbuild's rebuild dependencies. Manual mode
supports `write: false`.

Installed HTML must contain `<html>` and `<head>`. imgfmt owns the `data-imgfmt-runtime` marker and
accepts an existing `data-imgcaps` attribute only when its single value is `pending`.

## Runtime, CSP and Failure Behavior

Each document adapter installs:

```html
<html data-imgcaps="pending">
  <head>
    <script data-imgfmt-runtime>
      /* generated classic capability runtime */
    </script>
  </head>
</html>
```

All format probes run concurrently and share one deadline. Load, error, abort, invalid dimensions,
setup errors and timeouts all pass through one guarded barrier. The runtime then commits `ready`
plus every supported format in one `setAttribute` call; late callbacks are ignored.

The runtime has no dependency on Modernizr, JavaScript modules or native `Promise`.

> [!IMPORTANT]
> A strict Content Security Policy must allow the generated inline script through an applicable
> nonce, hash or broader inline-script policy. imgfmt does not currently expose a nonce/hash API.
> The built-in probes also require `data:` images to be allowed by `img-src` or `default-src`.

If JavaScript or the runtime is blocked, the document remains `pending`. Managed background and
mask URLs remain `none`, and managed cursor declarations remain absent. There is currently no
no-JavaScript restoration mode.

## Current Boundaries

imgfmt deliberately has a narrow product boundary:

- It never reads, downloads, decodes, encodes, converts, compresses, optimizes, emits or validates
  application image bytes.
- It manages only direct top-level URLs in the documented background, mask and cursor properties.
- SVG, fonts, TIFF, unknown source extensions, URI schemes and nested image functions are skipped.
- Native nesting, unsupported document/at-rule contexts, managed keyframe URLs and unresolved
  standalone `@import` fail explicitly.
- SSR, streaming HTML, Shadow DOM and CSS-in-JS do not have automatic integrations.
- Format count is capped at four because capability-state output grows as `2^k`.
- A real-browser request-logging oracle and maintained legacy-browser matrix are still future
  evidence work.

### Cascade specificity

Capability selectors add specificity so they can override the sanitized author rule in older
WebP-capable browsers. imgfmt does not mirror unrelated declarations or entire background/mask
cascade families.

As a result, a later lower-specificity `background: none`, `background-image: none`, `mask: none`,
`mask-image: none` or `all` reset may not override a generated ready declaration. Stylesheets that
depend on those cross-rule resets are outside the current contract.

## Development

This repository uses Node.js 24, pnpm 11, TypeScript 6 and Vite+.

```sh
pnpm install
pnpm check
pnpm test
pnpm build:all
```

Run the playground:

```sh
pnpm play
```

Run the Vue example:

```sh
pnpm example
```

## License

[MIT](LICENSE)
