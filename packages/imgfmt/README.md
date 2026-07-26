# imgfmt

CSS-first delivery of user-provided image format variants, with an exact-one loading goal.

> **Status:** experimental and not published yet. The first working vertical slice supports PostCSS and Vite; its API may still change before the first release.

## Installation

After the first public release:

```sh
pnpm add -D imgfmt postcss
```

## Vite

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

the application must provide `hero.png`, `hero.avif` and `hero.webp`. imgfmt does not generate image files. It keeps every candidate in Vite's normal asset pipeline and retains the original URL as the compatibility fallback.

Vue projects built with Vite use the same PostCSS path; dedicated Vue SFC integration coverage is still planned.

## Existing PostCSS config

When a project owns an external `postcss.config.*`, install both public entries with one shared option object:

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

## Scope

imgfmt manages direct, top-level `url()` occurrences in `background` and `background-image`. It injects a non-blocking classic runtime that probes formats with `new Image()` and atomically commits one complete capability state. Generated CSS selects exactly one URL for that state without requiring `image-set()`, CSS custom properties, JavaScript modules, native `Promise` or Modernizr.

imgfmt handles CSS, document integration and opaque URLs only. It never reads, decodes, encodes, converts or optimizes image bytes. Users provide and host every candidate.

The Vite entry supports document/client builds only and requires an HTML entry. Remove it from SSR and worker plugin lists. CSS libraries should use `imgfmt/postcss` and arrange document integration in the consuming application.

See the [repository README](https://github.com/rzzf/imgfmt#readme) for configuration details, CSS boundaries and development commands.

## License

[MIT](LICENSE)
