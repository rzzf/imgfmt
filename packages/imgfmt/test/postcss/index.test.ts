import postcss, { atRule, rule, type Result, type Rule } from "postcss";
import { describe, expect, it } from "vite-plus/test";

import imgfmt from "../../src/postcss";

describe("imgfmt/postcss", () => {
  it("materializes pending and every complete AVIF/WebP truth vector", async () => {
    const result = await transform(`
      .hero, html.theme .hero {
        background-color: #000;
        background-image: linear-gradient(#0008, #0000), url("./hero.png");
        background-position: center;
      }
    `);
    const rules = rulesFrom(result);

    expect(rules).toHaveLength(6);
    expect(rules.at(-1)?.selector).toBe(".hero, html.theme .hero");

    const pending = findRule(rules, "data-imgcaps~=pending");
    expect(pending.selector.match(/\[data-imgcaps\]/g)).toHaveLength(4);
    expect(pending.selector).toContain(":root[data-imgcaps");
    expect(pending.selector).toContain("html:root[data-imgcaps");
    expect(pending.nodes?.filter((node) => node.type === "decl")).toHaveLength(3);
    expect(
      pending.nodes?.find((node) => node.type === "decl" && node.prop === "background-image"),
    ).toHaveProperty("value", "linear-gradient(#0008, #0000), none");

    expect(imageValue(findRule(rules, "data-imgcaps~=no-avif", "data-imgcaps~=no-webp"))).toContain(
      'url("./hero.png")',
    );
    expect(imageValue(findRule(rules, "data-imgcaps~=no-avif", "data-imgcaps~=webp"))).toContain(
      'url("./hero.webp")',
    );
    expect(imageValue(findRule(rules, "data-imgcaps~=avif", "data-imgcaps~=no-webp"))).toContain(
      'url("./hero.avif")',
    );
    expect(imageValue(findRule(rules, "data-imgcaps~=avif", "data-imgcaps~=webp"))).toContain(
      'url("./hero.avif")',
    );
  });

  it("selects independently when different occurrences have different variants", async () => {
    const calls: string[] = [];
    const result = await transform(`.card { background-image: url(a.png), url("b.png"); }`, {
      resolveVariantUrl(request) {
        calls.push(`${request.originalUrl}:${request.format}`);

        if (request.originalUrl === "a.png" && request.format === "avif") {
          return Promise.resolve("/variants/a.avif");
        }

        if (request.originalUrl === "b.png" && request.format === "webp") {
          return "/variants/b.webp";
        }

        return undefined;
      },
    });
    const rules = rulesFrom(result);

    expect(calls).toEqual(["a.png:avif", "a.png:webp", "b.png:avif", "b.png:webp"]);
    expect(imageValue(findRule(rules, "data-imgcaps~=avif", "data-imgcaps~=webp"))).toBe(
      'url("/variants/a.avif"), url("/variants/b.webp")',
    );
  });

  it("decodes CSS URL escapes and preserves query strings and fragments", async () => {
    const originalUrls: string[] = [];
    const result = await transform(`.hero { background-image: url(hero\\20 image.png?x=1#top); }`, {
      formats: [{ id: "avif" }],
      resolveVariantUrl(request) {
        originalUrls.push(request.originalUrl);
        return `${request.originalUrl.replace(".png", ".avif")}`;
      },
    });

    expect(originalUrls).toEqual(["hero image.png?x=1#top"]);
    expect(imageValue(findRule(rulesFrom(result), "data-imgcaps~=avif"))).toBe(
      'url("hero image.avif?x=1#top")',
    );
  });

  it("normalizes escaped CSS identifiers before classifying declarations and values", async () => {
    const result = await transform(String.raw`.hero { backgroun\64-image: u\72l(hero.png); }`);
    const rules = rulesFrom(result);

    expect(imageValue(findRule(rules, "data-imgcaps~=pending"), "backgroun\\64-image")).toBe(
      "none",
    );
    expect(imageValue(findRule(rules, "data-imgcaps~=avif"), "backgroun\\64-image")).toBe(
      'url("hero.avif")',
    );

    await expect(transform(String.raw`.hero { background-image: v\61r(--hero); }`)).rejects.toThrow(
      "var() image values",
    );
    await expect(
      transform(String.raw`.hero { background-image: u\72 l(hero.png); }`),
    ).rejects.toThrow("split across value tokens");
    await expect(
      transform(String.raw`.hero { background-image: \75 rl(hero.png); }`),
    ).rejects.toThrow("split across value tokens");
    await expect(transform(`.hero { background-image: --hero(); }`)).rejects.toThrow(
      "Custom CSS functions",
    );
    await expect(transform(`.hero { background-image: if(style(--hero): none); }`)).rejects.toThrow(
      "if() image values",
    );
    await expect(transform(String.raw`@i\6dport url("theme.css");`)).rejects.toThrow("@import");
    await expect(transform(String.raw`@im\70 ort url("theme.css");`)).rejects.toThrow("@import");
    await expect(transform(String.raw`@impo\72t url("theme.css");`)).rejects.toThrow("@import");
  });

  it("normalizes parsed and programmatic at-rule names without consuming their params", async () => {
    const stylesheet = postcss.parse("");
    const media = atRule({ name: "media", params: "screen" });
    const hero = rule({ selector: ".hero" });
    hero.append({ prop: "background-image", value: "url(hero.png)" });
    media.append(hero);
    stylesheet.append(media);

    const result = await postcss([imgfmt()]).process(stylesheet, {
      from: "/project/src/programmatic.css",
    });
    expect(result.css).toContain("data-imgcaps");

    const imported = postcss.parse("");
    imported.append(atRule({ name: "import", params: 'url("theme.css")' }));
    await expect(
      postcss([imgfmt()]).process(imported, { from: "/project/src/import.css" }),
    ).rejects.toThrow("@import");
  });

  it("hides managed URLs while pending even when every variant is unavailable", async () => {
    const result = await transform(`.hero { background: center / cover url(hero.png); }`, {
      resolveVariantUrl: () => undefined,
    });
    const rules = rulesFrom(result);

    expect(backgroundValue(findRule(rules, "data-imgcaps~=pending"))).toBe("center / cover none");
    expect(backgroundValue(findRule(rules, "data-imgcaps~=avif", "data-imgcaps~=webp"))).toBe(
      "center / cover url(hero.png)",
    );
  });

  it("mirrors the complete background family and expands all without unrelated properties", async () => {
    const result = await transform(`
      .with-image { background: url(hero.png); }
      .reset { background: none; }
      .wide-reset { all: revert-layer !important; color: red; }
    `);
    const rules = rulesFrom(result);
    const resetMirrors = rules.filter(
      (rule) => rule.selector.includes("data-imgcaps") && rule.selector.endsWith(" .reset"),
    );
    const wideResetMirror = rules.find(
      (rule) =>
        rule.selector.includes("data-imgcaps~=pending") && rule.selector.endsWith(" .wide-reset"),
    );

    expect(resetMirrors).toHaveLength(5);
    expect(wideResetMirror?.nodes?.filter((node) => node.type === "decl")).toHaveLength(16);
    expect(
      wideResetMirror?.nodes?.some((node) => node.type === "decl" && node.prop === "color"),
    ).toBe(false);
    expect(wideResetMirror?.toString()).not.toContain("all:");
    expect(wideResetMirror?.toString()).toContain("background-image: revert-layer !important");
  });

  it("mirrors physical and logical background axis longhands to preserve cascade order", async () => {
    const result = await transform(`
      .hero { background: url(a.png) 0 0; }
      .hero {
        background-position-x: 100px;
        background-position-inline: 25%;
        background-repeat-y: no-repeat;
        background-repeat-block: space;
      }
    `);
    const mirrors = rulesFrom(result).filter(
      (rule) => rule.selector.includes("data-imgcaps~=avif") && rule.selector.endsWith(" .hero"),
    );
    const longhandMirror = mirrors.find((rule) =>
      rule.nodes?.some((node) => node.type === "decl" && node.prop === "background-position-x"),
    );

    expect(longhandMirror?.toString()).toContain("background-position-x: 100px");
    expect(longhandMirror?.toString()).toContain("background-position-inline: 25%");
    expect(longhandMirror?.toString()).toContain("background-repeat-y: no-repeat");
    expect(longhandMirror?.toString()).toContain("background-repeat-block: space");
  });

  it("inserts root gates before pseudo-elements", async () => {
    const result = await transform(
      String.raw`html::before, html:before, :r\6fot::after, .hero::before {
        background-image: url(hero.png);
      }`,
    );
    const pending = findRule(rulesFrom(result), "data-imgcaps~=pending");

    expect(pending.selector).toContain("html:root[data-imgcaps");
    expect(pending.selector).toContain(":root[data-imgcaps");
    expect(pending.selector).not.toMatch(/::?(?:before|after):root/);
  });

  it("waits for rejected resolvers and warns before falling back in permissive mode", async () => {
    const result = await transform(`.hero { background-image: url(hero.png); }`, {
      resolveVariantUrl({ format }) {
        return format === "avif" ? Promise.reject(new Error("manifest failed")) : undefined;
      },
      strict: false,
    });

    expect(result.warnings()).toHaveLength(1);
    expect(result.warnings()[0]?.text).toContain("manifest failed");
    expect(
      imageValue(findRule(rulesFrom(result), "data-imgcaps~=avif", "data-imgcaps~=webp")),
    ).toBe("url(hero.png)");
  });

  it("keeps structural CSS failures fatal in permissive resolver mode", async () => {
    const css = `
      :root { --hero: url(b.png); }
      .hero { background-image: url(a.png); }
      .hero { background-image: var(--hero); }
    `;
    await expect(transform(css, { strict: false })).rejects.toThrow("var() image values");
  });

  it("rejects contexts that cannot carry a root capability gate", async () => {
    await expect(
      transform(`@keyframes pulse { from { background-image: url(hero.png); } }`),
    ).rejects.toThrow("keyframes");
    await expect(transform(`.parent { & .child { background: url(hero.png); } }`)).rejects.toThrow(
      "nesting",
    );
  });
});

async function transform(css: string, options: Parameters<typeof imgfmt>[0] = {}): Promise<Result> {
  return await postcss([imgfmt(options)]).process(css, { from: "/project/src/style.css" });
}

function rulesFrom(result: Result): Rule[] {
  const rules: Rule[] = [];
  result.root.walkRules((rule) => {
    rules.push(rule);
  });
  return rules;
}

function findRule(rules: readonly Rule[], ...tokens: readonly string[]): Rule {
  const rule = rules.find((candidate) =>
    tokens.every((token) => candidate.selector.includes(token)),
  );

  if (rule === undefined) {
    throw new Error(`Missing rule with selector tokens: ${tokens.join(", ")}`);
  }

  return rule;
}

function imageValue(rule: Rule, property = "background-image"): string {
  const declaration = rule.nodes?.find((node) => node.type === "decl" && node.prop === property);

  if (declaration?.type !== "decl") {
    throw new Error("Missing background-image declaration");
  }

  return declaration.value;
}

function backgroundValue(rule: Rule): string {
  const declaration = rule.nodes?.find(
    (node) => node.type === "decl" && node.prop === "background",
  );

  if (declaration?.type !== "decl") {
    throw new Error("Missing background declaration");
  }

  return declaration.value;
}
