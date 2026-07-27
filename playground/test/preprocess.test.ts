import { describe, expect, it } from "vite-plus/test";

import { preprocessStylesheet, StylesheetPreprocessError } from "../src/preprocess";

describe("playground stylesheet preprocessing", () => {
  it("passes CSS through without loading a preprocessor", async () => {
    const source = `.banner { background-image: url("./banner.png"); }`;

    await expect(preprocessStylesheet(source, "css")).resolves.toBe(source);
  });

  it("reports one-based Sass source locations", async () => {
    const promise = preprocessStylesheet(
      `.banner {
  color: $missing;
}`,
      "scss",
    );

    await expect(promise).rejects.toMatchObject({
      column: 10,
      language: "scss",
      line: 2,
      message: "Undefined variable.",
      name: "StylesheetPreprocessError",
    });
  });

  it("reports one-based Less source locations", async () => {
    const promise = preprocessStylesheet(
      `.banner {
  color: @missing;
}`,
      "less",
    );

    await expect(promise).rejects.toMatchObject({
      column: 10,
      language: "less",
      line: 2,
      name: "StylesheetPreprocessError",
    });
  });

  it("rejects Less imports instead of issuing browser requests", async () => {
    const promise = preprocessStylesheet(`@import "missing.less";`, "less");

    await expect(promise).rejects.toEqual(
      expect.objectContaining<Partial<StylesheetPreprocessError>>({
        column: 1,
        language: "less",
        line: 1,
        message: expect.stringContaining("Could not find a file-manager"),
      }),
    );
  });

  it("compiles SCSS and Less blocks from a Vue template", async () => {
    const css = await preprocessStylesheet(
      `<template>
  <div class="banner">
    <div class="banner__image" />
  </div>
</template>

<style scoped>
.banner {
  color: v-bind(theme.color);
}
</style>

<style scoped lang="scss">
$image: "./banner-image.png";
.banner {
  &__image {
    background-image: url($image);
  }
}
</style>

<style lang="less">
@image: "./card.jpg";
.card {
  background-image: url(@image);
}
</style>`,
      "vue",
    );

    expect(css).toContain(".banner[data-v-imgfmt]");
    expect(css).toContain("var(--imgfmt-theme\\.color)");
    expect(css).toContain(".banner__image[data-v-imgfmt]");
    expect(css).toContain('url("./banner-image.png")');
    expect(css).toContain(".card");
    expect(css).toContain('url("./card.jpg")');
    expect(css).not.toContain("<template>");
    expect(css).not.toContain("$image");
    expect(css).not.toContain("@image");
    expect(css.indexOf(".banner[data-v-imgfmt]")).toBeLessThan(css.indexOf(".banner__image"));
    expect(css.indexOf(".banner__image")).toBeLessThan(css.indexOf(".card"));
  });

  it("maps Vue style preprocessing errors to the SFC source", async () => {
    const promise = preprocessStylesheet(
      `<template><div class="banner" /></template>

<style scoped lang="scss">
.banner {
  color: $missing;
}
</style>`,
      "vue",
    );

    await expect(promise).rejects.toMatchObject({
      column: 10,
      language: "vue",
      line: 5,
      message: "Undefined variable.",
      name: "StylesheetPreprocessError",
    });
  });

  it("rejects external and module Vue style blocks", async () => {
    await expect(
      preprocessStylesheet(
        `<template><div /></template>
<style src="./theme.scss"></style>`,
        "vue",
      ),
    ).rejects.toMatchObject({
      language: "vue",
      message: expect.stringContaining("<style src>"),
    });

    await expect(
      preprocessStylesheet(
        `<template><div /></template>
<style module>.banner { color: red; }</style>`,
        "vue",
      ),
    ).rejects.toMatchObject({
      language: "vue",
      message: expect.stringContaining("<style module>"),
    });
  });

  it("reports malformed and unsupported Vue template input", async () => {
    await expect(
      preprocessStylesheet(
        `<template><div></template>
<style>.banner { color: red; }</style>`,
        "vue",
      ),
    ).rejects.toMatchObject({
      column: 11,
      language: "vue",
      line: 1,
      message: "Element is missing end tag.",
    });

    await expect(
      preprocessStylesheet(
        `<template><div /></template>
<style lang="sass">.banner
  color: red
</style>`,
        "vue",
      ),
    ).rejects.toMatchObject({
      language: "vue",
      message: expect.stringContaining('lang="sass"'),
    });

    await expect(
      preprocessStylesheet(`<template><div class="banner" /></template>`, "vue"),
    ).rejects.toMatchObject({
      language: "vue",
      message: expect.stringContaining("at least one inline <style>"),
    });
  });
});
