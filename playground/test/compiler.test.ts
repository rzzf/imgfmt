import { describe, expect, it } from "vite-plus/test";

import { compileCss } from "../src/compile";
import { stylesheetLanguages } from "../src/stylesheets";
import { tools } from "../src/tools";

describe("playground compiler", () => {
  it("runs the canonical compiler with the default format registry", async () => {
    const result = await compileCss({
      formatPreset: "default",
      inputLanguage: "css",
      source: `.banner { background: url("./banner.png") center / cover; }`,
      tool: "vite",
    });

    expect(result.readyRuleCount).toBe(3);
    expect(result.css).toContain("./banner.avif");
    expect(result.css).toContain("./banner.webp");
    expect(result.css).toContain(`background: none center / cover`);
  });

  it("changes capability-state expansion with the selected format preset", async () => {
    const result = await compileCss({
      formatPreset: "webp",
      inputLanguage: "css",
      source: `.banner { background-image: url("./banner.png"); }`,
      tool: "webpack",
    });

    expect(result.readyRuleCount).toBe(2);
    expect(result.css).not.toContain("avif");
    expect(result.css).toContain("./banner.webp");
  });

  it("leaves SVG URLs outside the managed raster image set", async () => {
    const source = `.banner {
  background:
    url("./banner.svg?theme=dark#cover") center / cover no-repeat;
}`;
    const result = await compileCss({
      formatPreset: "default",
      inputLanguage: "css",
      source,
      tool: "vite",
    });

    expect(result.readyRuleCount).toBe(0);
    expect(result.css).toBe(source);
    expect(result.css).not.toContain(".avif");
    expect(result.css).not.toContain(".webp");
  });

  it("compiles the mask declarations used by the project stylesheet", async () => {
    const result = await compileCss({
      formatPreset: "default",
      inputLanguage: "css",
      source: `.btn-pre span {
  -webkit-mask-image: url('../images/en/btn_pre.png');
  mask-image: url('../images/en/btn_pre.png');
}

.section-05.loaded .intro-swiper {
  -webkit-mask: url('../images/store_pic1_mask.png') center/100% 100% no-repeat;
  mask: url('../images/store_pic1_mask.png') center/100% 100% no-repeat;
}`,
      tool: "vite",
    });

    expect(result.readyRuleCount).toBe(6);
    expect(result.css).toContain("-webkit-mask-image: url('../images/en/btn_pre.avif')");
    expect(result.css).toContain("mask-image: url('../images/en/btn_pre.webp')");
    expect(result.css).toContain("-webkit-mask-image: url('../images/store_pic1_mask.avif')");
    expect(result.css).toContain("mask: none center/100% 100% no-repeat");
  });

  it("moves cursor declarations into ready rules", async () => {
    const result = await compileCss({
      formatPreset: "default",
      inputLanguage: "css",
      source: `.pointer-button { cursor: url("./pointer.png") 4 5, pointer; }`,
      tool: "vite",
    });

    expect(result.readyRuleCount).toBe(3);
    expect(result.css).toContain('cursor: url("./pointer.png") 4 5, pointer');
    expect(result.css).toContain('cursor: url("./pointer.webp") 4 5, pointer');
    expect(result.css).toContain('cursor: url("./pointer.avif") 4 5, pointer');
    expect(result.css).not.toContain("cursor: none");
    expect(result.css).not.toMatch(/(?:^|\n)\.pointer-button\s*\{/);
  });

  it("compiles Sass before transforming generated CSS", async () => {
    const result = await compileCss({
      formatPreset: "default",
      inputLanguage: "scss",
      source: `$overlay: #1118;
.gallery {
  &__card {
    background:
      linear-gradient(135deg, $overlay, transparent),
      url("./gallery-card.png") center / cover no-repeat;
  }
}`,
      tool: "vite",
    });

    expect(result.readyRuleCount).toBe(3);
    expect(result.css).toContain(".gallery__card");
    expect(result.css).toContain("./gallery-card.avif");
    expect(result.css).toContain("./gallery-card.webp");
    expect(result.css).not.toContain("$overlay");
  });

  it("compiles Less before transforming generated CSS", async () => {
    const result = await compileCss({
      formatPreset: "default",
      inputLanguage: "less",
      source: `@image: "./gallery-card.png";
.gallery {
  &__card {
    background-image: url(@image);
  }
}`,
      tool: "vite",
    });

    expect(result.readyRuleCount).toBe(3);
    expect(result.css).toContain(".gallery__card");
    expect(result.css).toContain("./gallery-card.avif");
    expect(result.css).toContain("./gallery-card.webp");
    expect(result.css).not.toContain("@image");
  });

  it("compiles scoped styles from a Vue template", async () => {
    const result = await compileCss({
      formatPreset: "default",
      inputLanguage: "vue",
      source: `<script setup lang="ts">
const title = "Adaptive banner";
</script>

<template>
  <section class="banner">{{ title }}</section>
</template>

<style scoped>
.banner {
  background-image: url("./banner.png");
}
</style>`,
      tool: "vite",
    });

    expect(result.readyRuleCount).toBe(3);
    expect(result.css).toContain(".banner[data-v-imgfmt]");
    expect(result.css).toContain("./banner.avif");
    expect(result.css).toContain("./banner.webp");
    expect(result.css).not.toContain("<template>");
    expect(result.css).not.toContain("<script");
  });

  it("keeps capability gates around scoped Vue global selectors", async () => {
    const result = await compileCss({
      formatPreset: "default",
      inputLanguage: "vue",
      source: `<template><section class="banner" /></template>
<style scoped>
:global(.banner) {
  background-image: url("./banner.png");
}
</style>`,
      tool: "vite",
    });

    expect(result.readyRuleCount).toBe(3);
    expect(result.css.match(/:root\[data-imgcaps/g)).toHaveLength(3);
    expect(result.css).toContain(".banner");
    expect(result.css).toContain("background-image: none");
  });

  it.each(stylesheetLanguages)("compiles the default $label example", async (language) => {
    const result = await compileCss({
      formatPreset: "default",
      inputLanguage: language.id,
      source: language.defaultSource,
      tool: "vite",
    });

    expect(result.readyRuleCount).toBeGreaterThan(0);
    expect(result.css).toContain("./banner.avif?theme=dark#cover");
    expect(result.css).toContain("./banner.webp?theme=dark#cover");
  });

  it("documents every public compiler and host entry", () => {
    expect(tools.map((tool) => tool.id)).toEqual([
      "vite",
      "rollup",
      "rolldown",
      "webpack",
      "rspack",
      "esbuild",
      "postcss",
    ]);
    expect(tools.find((tool) => tool.id === "webpack")?.mode).toBe("Manual CSS");
    expect(tools.find((tool) => tool.id === "rspack")?.mode).toBe("Manual CSS");
  });

  it("keeps copied host configuration aligned with the selected formats", () => {
    const webpack = tools.find((tool) => tool.id === "webpack");
    const vite = tools.find((tool) => tool.id === "vite");

    expect(webpack?.snippet("webp")).toContain('formats: [{ id: "webp" }]');
    expect(webpack?.snippet("webp")).not.toContain('{ id: "avif" }');
    expect(webpack?.snippet("webp")).toContain("imgfmtPostcss(options)");
    expect(webpack?.snippet("webp")).toContain('"postcss-loader"');
    expect(vite?.snippet("default")).toContain('formats: [{ id: "avif" }, { id: "webp" }]');
  });
});
