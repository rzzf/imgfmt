# imgfmt

CSS-first delivery of user-provided image format variants with an exact-one loading goal.

> **Status:** early architecture scaffold. The CSS transformer and build-tool adapters are not yet usable or published.

## Goals

- Map image-bearing CSS values to user-provided WebP, AVIF or other format URLs.
- Preserve the original URL as the final compatibility fallback.
- Ensure one logical CSS image makes at most one candidate eligible after capability detection.
- Support browsers that can display WebP but do not support `image-set()` or CSS custom properties.
- Share one PostCSS implementation across Vite, Vue, webpack-family tools and Parcel integrations.

## Scope boundary

imgfmt handles CSS and opaque URLs only. It does not read, download, decode, encode, convert, optimize, emit or validate application images. Users provide and host every candidate image; the owning build tool retains its normal URL resolution, hashing, public-path and missing-file behavior.

## Design outline

1. Static HTML begins with `data-imgcaps="pending"` before transformed CSS can apply.
2. A small asynchronous classic script runs Modernizr-style `new Image()` probes in parallel.
3. All probe outcomes, including errors and a deadline, converge on one barrier.
4. One atomic attribute mutation publishes the complete capability vector.
5. Property-aware CSS gates mutually exclusive direct declarations and retains the original fallback.

The compatibility backend does not require `image-set()`, CSS variables, JavaScript modules, native `Promise` or Modernizr itself.

Built-in probes currently represent lossy/static/opaque WebP and Baseline/8-bit/static/opaque AVIF. Other image profiles require matching user-configured probes. Embedded `data:` probes may require an appropriate `img-src` CSP policy; a blocked probe safely falls back to a lower-priority format or the original.

## Repository layout

| Workspace           | Responsibility                                     |
| ------------------- | -------------------------------------------------- |
| `packages/imgfmt`   | Intended public facade and options                 |
| `packages/core`     | Host-neutral URL selection policy                  |
| `packages/runtime`  | Probe barrier and classic runtime source generator |
| `packages/postcss`  | CSS discovery and materialization                  |
| `packages/unplugin` | Shared host lifecycle shell                        |
| `packages/parcel`   | Native Parcel integration                          |

All package manifests remain private until the public API and end-to-end behavior are ready.

## Development

Requirements are managed by Vite+:

- Node.js 24 LTS, with a package compatibility floor of `>=24.15.0`;
- pnpm 11;
- TypeScript 6;
- shared dependency versions through pnpm catalogs.

```sh
vp install
vp check
vp test --run
vp run -r build
```

Tests live under each owning package's `test` directory.

## License

[MIT](LICENSE)
