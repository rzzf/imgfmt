# Repository guidelines

These instructions apply to the entire repository. Current source, tests and the public README are
the source of truth.

## Product boundary

imgfmt is a CSS delivery compiler plus a browser capability runtime. Callers provide every
original, AVIF, WebP or custom-format image.

imgfmt must not read, download, decode, encode, convert, compress, optimize, emit or validate
application image bytes. Generated image URLs stay in the owning build tool's CSS and asset
pipeline.

Do not add image conversion, encoders, application-image caches, server negotiation or a Parcel
adapter without an explicit product decision.

## CSS contract

The compiler manages direct, top-level, local raster-image `url()` occurrences in:

- `background`
- `background-image`
- `mask`
- `mask-image`
- `-webkit-mask`
- `-webkit-mask-image`
- `cursor`

Keep these invariants:

- Skip URLs with any URI scheme and protocol-relative URLs beginning with `//`.
- Accept source extensions `.apng`, `.avif`, `.bmp`, `.gif`, `.ico`, `.jfif`, `.jpeg`, `.jpg`,
  `.png` and `.webp`, case-insensitively before query or fragment text.
- Skip SVG, TIFF, fonts, extensionless paths, unknown extensions and nested URLs such as
  `image-set(url(...))`.
- Preserve raw URL payload text, quotes, escapes and whitespace. The default resolver changes only
  the filename suffix and preserves query/fragment text.
- Start all configured variant-resolution jobs before awaiting them, and wait for all jobs before
  materializing CSS.
- Generate the minimum image longhand from a shorthand: `background-image`, `mask-image` or
  `-webkit-mask-image`. Copy only the image layers.
- Evaluate every capability state and emit only positive `ready`/supported-format gates whose
  declaration block is distinct through the generated cascade.
- Replace managed background/mask URLs in the source declaration with `none`.
- Remove a managed `cursor` declaration from the source rule and restore its complete syntax only
  in ready rules; `cursor: none` is not a valid substitute for URL cursor syntax.
- Do not mirror resets, pure gradients, unrelated declarations or complete background/mask
  families.

Capability gates intentionally add specificity. A generated ready rule can outrank a later
lower-specificity reset. Do not reintroduce full cascade mirroring without an explicit product
decision.

## Browser runtime

- Install exactly one `data-imgcaps="pending"` root state.
- Inject exactly one inline classic script at the start of `<head>`, marked
  `data-imgfmt-runtime`.
- Keep browser logic in `src/runtime/browser-runtime.js`; `renderBrowserRuntime` should only
  validate the function source and safely serialize invocation data.
- Keep the shipped runtime ES5-compatible and free of modules, native `Promise`, CSS variables,
  `image-set()` and Modernizr dependencies.
- Start all `new Image()` probes concurrently behind one error/deadline barrier.
- Commit `ready` plus supported format tokens with one guarded `setAttribute`; ignore late and
  duplicate callbacks.
- Default probes cover baseline static AVIF and lossy static WebP. The default deadline is 500 ms.
- There is currently no capability cache, no-JavaScript restoration or CSP nonce/hash API.

## Repository layout

The repository root is the single publishable `imgfmt` package:

```text
src/
  index.ts  types.ts  unplugin.ts  postcss.ts
  vite.ts  rollup.ts  rolldown.ts
  webpack.ts  rspack.ts  esbuild.ts
  core/  css/  runtime/
test/
playground/
examples/
```

Public exports are `.`, `./postcss`, `./vite`, `./rollup`, `./rolldown`, `./webpack`, `./rspack`
and `./esbuild`. Keep public entry files thin and internal directories private.

Adapter responsibilities:

- Vite owns automatic/manual PostCSS integration and HTML/runtime delivery.
- Rollup and Rolldown require a downstream CSS extractor and at least one emitted HTML asset.
- webpack and Rspack require `postcss: "manual"`, `imgfmt/postcss` in the CSS pipeline and their
  HTML plugin.
- esbuild requires explicit static or manual document ownership.
- Standalone PostCSS transforms CSS only and does not install the document runtime.
- Vue uses its owning build tool's CSS pipeline; there is no separate Vue adapter.

## Tooling and workflow

- Use Node.js `>=24.15.0`, pnpm 11, TypeScript 6 and the Vite+ commands defined in the root
  `package.json`.
- Shared dependency versions belong in the default pnpm catalog and should use `catalog:`.
- Keep public output ESM-only with `module-sync`; public module graphs must not use top-level
  `await`.
- Put package tests and fixtures under `test/<area>/`. Runnable applications belong under
  `examples/`; the browser compiler workspace belongs under `playground/`.
- Update the README when public behavior, configuration or support boundaries change.
- Keep repository documentation product-facing. Do not commit internal working notes, session
  records, planning logs or temporary analysis.

Before committing a change, run the relevant focused tests and then:

```sh
pnpm check
pnpm test
pnpm build:all
```

Preserve unrelated working-tree changes and keep commits scoped to the requested work.
