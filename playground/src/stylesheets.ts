export type StylesheetLanguageId = "css" | "less" | "scss" | "vue";

export interface StylesheetLanguageDefinition {
  readonly defaultSource: string;
  readonly extension: string;
  readonly id: StylesheetLanguageId;
  readonly label: string;
}

export const stylesheetLanguages = [
  {
    defaultSource: `.banner {
  background:
    linear-gradient(135deg, #1118, transparent),
    url("./banner.png?theme=dark#cover") center / cover no-repeat;
}

.card {
  background-image:
    image-set(url("./nested.png") 1x),
    url('./card.jpg');
}

.masked-button {
  -webkit-mask-image: url("./button-mask.png");
  mask-image: url("./button-mask.png");
}

.pointer-button {
  cursor: url("./pointer.png") 4 5, pointer;
}

.remote {
  background-image: url("https://cdn.example.com/texture.png");
}`,
    extension: "css",
    id: "css",
    label: "CSS",
  },
  {
    defaultSource: `$overlay: #1118;

.banner {
  background:
    linear-gradient(135deg, $overlay, transparent),
    url("./banner.png?theme=dark#cover") center / cover no-repeat;
}

.gallery {
  &__card {
    background-image: url("./card.jpg");
  }
}`,
    extension: "scss",
    id: "scss",
    label: "Sass (SCSS)",
  },
  {
    defaultSource: `@overlay: #1118;

.banner {
  background:
    linear-gradient(135deg, @overlay, transparent),
    url("./banner.png?theme=dark#cover") center / cover no-repeat;
}

.gallery {
  &__card {
    background-image: url("./card.jpg");
  }
}`,
    extension: "less",
    id: "less",
    label: "Less",
  },
  {
    defaultSource: `<script setup lang="ts">
const title = "Adaptive banner";
</script>

<template>
  <section class="banner">{{ title }}</section>
</template>

<style scoped>
.banner {
  background:
    linear-gradient(135deg, #1118, transparent),
    url("./banner.png?theme=dark#cover") center / cover no-repeat;
}
</style>`,
    extension: "vue",
    id: "vue",
    label: "Vue SFC",
  },
] as const satisfies readonly StylesheetLanguageDefinition[];

export function getStylesheetLanguage(id: StylesheetLanguageId): StylesheetLanguageDefinition {
  const language = stylesheetLanguages.find((candidate) => candidate.id === id);

  if (language === undefined) {
    throw new TypeError(`Unknown stylesheet language: ${id}`);
  }

  return language;
}

export function isStylesheetLanguageId(value: string): value is StylesheetLanguageId {
  return stylesheetLanguages.some((language) => language.id === value);
}
