# Vue 3 + Vite example

This project exercises the local `imgfmt` workspace package through a real Vue SFC and the official
Vite Vue plugin.

From the repository root:

```sh
pnpm install
pnpm example
```

Then open the printed local URL. The page shows:

- the live `data-imgcaps` value committed by the inline imgfmt runtime;
- the expected and computed background format;
- controls for previewing each positive-token capability state;
- a color-coded PNG, WebP or AVIF background;
- the final computed `background-image` URL.

For a production check:

```sh
pnpm --filter imgfmt-example-vue3-vite build
pnpm --filter imgfmt-example-vue3-vite preview
```

The built HTML must contain `data-imgcaps="pending"` and one inline `data-imgfmt-runtime` script.
The built assets must contain the original PNG plus WebP and AVIF variants. imgfmt references these
caller-provided files; it does not create them.
