# imgfmt

CSS-first delivery of user-provided image format variants, with an exact-one loading goal.

> **Status:** experimental and not published yet. The first working vertical slice supports PostCSS and Vite; its API may still change before the first release.

## Installation

After the first public release:

```sh
pnpm add -D imgfmt postcss
```

To work on the repository now:

```sh
git clone https://github.com/rzzf/imgfmt.git
cd imgfmt
vp install
```

## Vite

The default configuration prefers AVIF, then WebP, then the retained original URL:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import imgfmt from "imgfmt/vite";

export default defineConfig({
  plugins: [imgfmt()],
});
```

Given this CSS:

```css
.hero {
  background-image: url("./hero.png");
}
```

the application must provide these files:

```text
hero.png
hero.avif
hero.webp
```

imgfmt never creates those files. Every generated URL remains in Vite's normal asset pipeline, including URL resolution, hashing, public paths and missing-file errors.

Vue projects built with Vite use the same PostCSS path; dedicated Vue SFC integration coverage is still planned.

### Existing PostCSS config

Vite does not expose a safe API for appending a plugin after an external `postcss.config.*` file. imgfmt therefore stops with an actionable error instead of replacing that configuration. Share one option object, install the PostCSS entry manually, and set `postcss: "manual"` on the Vite adapter:

```ts
// imgfmt.config.ts
import { defineConfig } from "imgfmt";

export default defineConfig({
  postcss: "manual",
  formats: [
    { id: "avif", extension: ".avif" },
    { id: "webp", extension: ".webp" },
  ],
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

The `/postcss` entry is the CSS compiler. Pair it with a host integration such as `/vite`, which owns the HTML state and browser runtime.

## Custom URLs and formats

The default resolver replaces the filename extension while preserving query strings and fragments. A synchronous or asynchronous resolver can instead return opaque URLs:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import imgfmt from "imgfmt/vite";

const variantManifest: Record<string, Record<string, string | undefined>> = {
  "./hero.png": {
    avif: "https://cdn.example.com/hero.avif",
    webp: "https://cdn.example.com/hero.webp",
  },
};

export default defineConfig({
  plugins: [
    imgfmt({
      formats: [
        { id: "avif", extension: ".avif" },
        { id: "webp", extension: ".webp" },
      ],
      async resolveVariantUrl({ originalUrl, format }) {
        return variantManifest[originalUrl]?.[format];
      },
    }),
  ],
});
```

Returning `undefined` means that format is unavailable for that particular URL occurrence. Selection continues through the configured preference order and finally restores the original. A custom format must provide one or more browser probes:

```ts
import { defineConfig } from "imgfmt";

const options = defineConfig({
  formats: [
    {
      id: "example",
      extension: ".example",
      probes: [{ uri: "data:image/example;base64,...", width: 1, height: 1 }],
    },
  ],
});
```

At most four formats are accepted because the compatibility backend emits every complete capability truth vector.

## How delivery works

1. Built HTML contains `data-imgcaps="pending"` before CSS is evaluated.
2. Vite injects a small external classic script with `async`; it does not block HTML parsing.
3. The script starts Modernizr-style `new Image()` probes together, waits for every result or a deadline, and commits one complete capability state atomically.
4. PostCSS emits mutually exclusive declarations for pending and every ready state. Each image occurrence independently chooses the first supported format that has a URL, otherwise the original.
5. All competing declarations in the supported background cascade family are mirrored with equal gate specificity, preserving shorthand/longhand order and `!important` behavior.

The browser compatibility layer does not require `image-set()`, CSS custom properties, JavaScript modules, native `Promise` or Modernizr itself. Built-in probes cover baseline static AVIF and lossy static WebP. Probe `data:` URLs require a compatible `img-src` CSP policy; if the runtime or its probes are blocked, managed backgrounds remain suppressed rather than loading multiple candidates.

## Current CSS boundary

The first slice manages direct, top-level `url()` occurrences in `background` and `background-image`. It also mirrors:

- `background`, its Level 3 longhands, and the physical/logical position and repeat axis longhands from Level 4;
- CSS-wide `all` resets, expanded only to those longhands;
- rules inside `@media`, `@supports`, `@container` and `@layer`.

Structural CSS failures are always fatal because partial transformation across several stylesheets could change the cascade. This includes keyframes, `@scope`, native nesting, unresolved `@import`, indirect root selectors, ambiguous escaped value identifiers, `image-set()`, `cross-fade()` and dynamic top-level image values. `strict: false` only lets an individual URL resolver failure warn and fall back for that candidate.

The Vite entry supports document/client builds only and requires an HTML entry so it can install the static pending state and runtime. Remove it from SSR and worker plugin lists. CSS libraries should use `imgfmt/postcss` and arrange their document integration in the consuming application. Documents that omit an explicit `<html>` element, inline styles, unprocessed stylesheets and shadow roots are outside the current guarantee.

## Scope boundary

imgfmt handles CSS, document integration and opaque URLs only. It does not read, download, decode, encode, convert, optimize, emit or validate application image bytes. Image generation and compression belong in a separate tool; users provide and host every candidate.

## Build-tool status

- Vite: working experimental adapter, including HTML and development/build runtime delivery.
- PostCSS: working shared CSS compiler.
- Vue with Vite: uses the same PostCSS pipeline; dedicated SFC integration coverage is planned.
- Parcel and other unplugin-family hosts: planned; no public adapter is exposed yet.

## Repository layout

| Workspace         | Responsibility                                      |
| ----------------- | --------------------------------------------------- |
| `packages/imgfmt` | The public package and its root, PostCSS, Vite paths |
| `packages/parcel` | Private research scaffold for a native Parcel path   |

All package manifests remain private until the public API and browser request behavior are ready for release.

## Development

The repository uses Node.js 24, pnpm 11, TypeScript 6 and Vite+. Shared dependency versions are managed through pnpm catalogs.

```sh
vp install
vp check
vp test --run
vp run -r build
```

Tests live under each owning package's `test` directory.

## License

[MIT](LICENSE)
