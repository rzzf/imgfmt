import postcss, { type Result, type Rule } from "postcss";
import { describe, expect, it } from "vite-plus/test";

import imgfmt from "../../src/postcss";

describe("imgfmt/postcss", () => {
  it("uses positive tokens and omits a redundant combined state", async () => {
    const result = await transform(`
      .banner, html.theme .banner {
        background-color: #000;
        background-image: linear-gradient(#0008, #0000), url( "./banner.png?x=1#top" );
        background-position: center;
      }
    `);
    const rules = rulesFrom(result);

    expect(rules).toHaveLength(4);
    expect(rules.at(-1)?.selector).toBe(".banner, html.theme .banner");
    expect(rules.slice(0, -1).map((rule) => [...capabilityTokens(rule)].join(" "))).toEqual([
      "ready",
      "ready webp",
      "ready avif",
    ]);
    expect(result.css).not.toContain("no-avif");
    expect(result.css).not.toContain("no-webp");

    const original = rules.at(-1) as Rule;
    expect(imageValue(original)).toBe("linear-gradient(#0008, #0000), none");

    expect(imageValue(findCapabilityRule(rules))).toBe(
      'linear-gradient(#0008, #0000), url( "./banner.png?x=1#top" )',
    );
    expect(imageValue(findCapabilityRule(rules, "webp"))).toBe(
      'linear-gradient(#0008, #0000), url( "./banner.webp?x=1#top" )',
    );
    expect(imageValue(findCapabilityRule(rules, "avif"))).toBe(
      'linear-gradient(#0008, #0000), url( "./banner.avif?x=1#top" )',
    );
    expect(() => findCapabilityRule(rules, "avif", "webp")).toThrow("Missing rule");
  });

  it("preserves URL quoting and spacing while replacing only the payload suffix", async () => {
    const calls: string[] = [];
    const result = await transform(
      `.card { background-image: url(a.png), url( 'b.png' ), url("card\\20 background.png?x=1#top"); }`,
      {
        resolveVariantUrl(request) {
          calls.push(`${request.originalUrl}:${request.format}`);
          return request.originalUrl.replace(/\.png(?=[?#]|$)/, request.extension);
        },
      },
    );
    const ready = findCapabilityRule(rulesFrom(result), "avif");

    expect(calls).toEqual([
      "a.png:avif",
      "a.png:webp",
      "b.png:avif",
      "b.png:webp",
      String.raw`card\20 background.png?x=1#top:avif`,
      String.raw`card\20 background.png?x=1#top:webp`,
    ]);
    expect(imageValue(ready)).toBe(
      String.raw`url(a.avif), url( 'b.avif' ), url("card\20 background.avif?x=1#top")`,
    );
  });

  it("never resolves or rewrites protocol and protocol-relative URLs", async () => {
    const calls: string[] = [];
    const result = await transform(
      `
        .remote { background-image: url("https://cdn.example/a.png"); }
        .mixed {
          background-image: url('./local.png'), url(https://cdn.example/b.png), url(//cdn.example/c.png), url(data:image/png;base64,AA);
        }
      `,
      {
        resolveVariantUrl(request) {
          calls.push(`${request.originalUrl}:${request.format}`);
          return request.originalUrl.replace(/\.png$/, request.extension);
        },
      },
    );
    const rules = rulesFrom(result);
    const remoteRules = rules.filter((rule) => rule.selector.endsWith(" .remote"));
    const originalMixed = rules.find((rule) => rule.selector === ".mixed") as Rule;
    const ready = findCapabilityRule(rules, "avif");

    expect(calls).toEqual(["./local.png:avif", "./local.png:webp"]);
    expect(remoteRules).toHaveLength(0);
    expect(imageValue(ready)).toBe(
      "url('./local.avif'), url(https://cdn.example/b.png), url(//cdn.example/c.png), url(data:image/png;base64,AA)",
    );
    expect(imageValue(originalMixed)).toBe(
      "none, url(https://cdn.example/b.png), url(//cdn.example/c.png), url(data:image/png;base64,AA)",
    );
    expect(result.css).not.toMatch(/cdn\.example\/[bc]\.(?:avif|webp)/);
  });

  it("only manages URLs with supported raster image extensions", async () => {
    const calls: string[] = [];
    const result = await transform(
      `
        .vector {
          background: url("./banner.svg?theme=dark#cover") center / cover no-repeat;
        }
        .raster {
          background-image: url("./photo.JPEG?theme=dark#cover");
        }
      `,
      {
        resolveVariantUrl(request) {
          calls.push(`${request.originalUrl}:${request.format}`);
          return request.originalUrl.replace(/\.jpeg(?=[?#]|$)/i, request.extension);
        },
      },
    );
    const rules = rulesFrom(result);
    const vectorRules = rules.filter((rule) => rule.selector.endsWith(" .vector"));

    expect(calls).toEqual([
      "./photo.JPEG?theme=dark#cover:avif",
      "./photo.JPEG?theme=dark#cover:webp",
    ]);
    expect(vectorRules).toHaveLength(0);
    expect(result.css).toContain(
      'background: url("./banner.svg?theme=dark#cover") center / cover no-repeat',
    );
    expect(result.css).not.toContain("banner.avif");
    expect(result.css).not.toContain("banner.webp");
    expect(imageValue(findCapabilityRule(rules, "avif"))).toBe(
      'url("./photo.avif?theme=dark#cover")',
    );
  });

  it("reduces background shorthand to the smallest image property", async () => {
    const result = await transform(`
      .banner {
        color: white;
        background: url('./banner.png') 50% / cover no-repeat, linear-gradient(red, blue) center;
      }
    `);
    const rules = rulesFrom(result);
    const mirrors = rules.filter((rule) => rule.selector.endsWith(" .banner"));
    const original = rules.find((rule) => rule.selector === ".banner");

    expect(mirrors).toHaveLength(3);
    expect(
      mirrors.every((rule) =>
        declarationsFrom(rule).every((declaration) => declaration.prop === "background-image"),
      ),
    ).toBe(true);
    expect(imageValue(findCapabilityRule(mirrors, "avif"))).toBe(
      "url('./banner.avif'), linear-gradient(red, blue)",
    );
    expect(declarationsFrom(original as Rule).map(({ prop }) => prop)).toEqual([
      "color",
      "background",
    ]);
    expect(declarationsFrom(original as Rule)[1]?.value).toBe(
      "none 50% / cover no-repeat, linear-gradient(red, blue) center",
    );
  });

  it("transforms standard and WebKit-prefixed mask-image declarations", async () => {
    const properties: string[] = [];
    const result = await transform(
      `
        .btn-pre span {
          -webkit-mask-image: url( '../images/en/btn_pre.png' );
          mask-image: linear-gradient(black, transparent), url("../images/en/btn_pre.png");
        }
      `,
      {
        resolveVariantUrl(request) {
          properties.push(request.property ?? "");
          return request.originalUrl.replace(/\.png$/, request.extension);
        },
      },
    );
    const rules = rulesFrom(result);
    const original = rules.find((rule) => rule.selector === ".btn-pre span") as Rule;
    const avif = findCapabilityRule(rules, "avif");

    expect(properties).toEqual([
      "-webkit-mask-image",
      "-webkit-mask-image",
      "mask-image",
      "mask-image",
    ]);
    expect(propertyValue(avif, "-webkit-mask-image")).toBe("url( '../images/en/btn_pre.avif' )");
    expect(propertyValue(avif, "mask-image")).toBe(
      'linear-gradient(black, transparent), url("../images/en/btn_pre.avif")',
    );
    expect(propertyValue(original, "-webkit-mask-image")).toBe("none");
    expect(propertyValue(original, "mask-image")).toBe("linear-gradient(black, transparent), none");
  });

  it("reduces standard and WebKit-prefixed mask shorthands to image longhands", async () => {
    const result = await transform(`
      .section-05.loaded .intro-swiper {
        -webkit-mask: url('../images/store_pic1_mask.png') center/100% 100% no-repeat;
        mask: url('../images/store_pic1_mask.png') center/100% 100% no-repeat;
      }
    `);
    const rules = rulesFrom(result);
    const mirrors = rules.filter((rule) =>
      rule.selector.endsWith(" .section-05.loaded .intro-swiper"),
    );
    const original = rules.find(
      (rule) => rule.selector === ".section-05.loaded .intro-swiper",
    ) as Rule;
    const avif = findCapabilityRule(mirrors, "avif");

    expect(mirrors).toHaveLength(3);
    expect(
      mirrors.every((rule) =>
        declarationsFrom(rule).every(
          (declaration) =>
            declaration.prop === "-webkit-mask-image" || declaration.prop === "mask-image",
        ),
      ),
    ).toBe(true);
    expect(propertyValue(avif, "-webkit-mask-image")).toBe("url('../images/store_pic1_mask.avif')");
    expect(propertyValue(avif, "mask-image")).toBe("url('../images/store_pic1_mask.avif')");
    expect(propertyValue(original, "-webkit-mask")).toBe("none center/100% 100% no-repeat");
    expect(propertyValue(original, "mask")).toBe("none center/100% 100% no-repeat");
  });

  it("moves cursor declarations into ready rules without emitting an invalid pending value", async () => {
    const properties: string[] = [];
    const result = await transform(
      `
        .pointer { cursor: url(pointer.png) 4 5, pointer; }
        .mixed {
          color: red;
          cursor: url(other-pointer.png), auto;
        }
      `,
      {
        resolveVariantUrl(request) {
          properties.push(request.property ?? "");
          return request.originalUrl.replace(/\.png$/, request.extension);
        },
      },
    );
    const rules = rulesFrom(result);
    const mixedSource = rules.find((rule) => rule.selector === ".mixed") as Rule;

    expect(properties).toEqual(["cursor", "cursor", "cursor", "cursor"]);
    expect(rules).toHaveLength(7);
    expect(rules.some((rule) => rule.selector === ".pointer")).toBe(false);
    expect(declarationsFrom(mixedSource).map(({ prop, value }) => [prop, value])).toEqual([
      ["color", "red"],
    ]);
    expect(propertyValue(findCapabilityRule(rules), "cursor")).toBe(
      "url(pointer.png) 4 5, pointer",
    );
    expect(propertyValue(findCapabilityRule(rules, "webp"), "cursor")).toBe(
      "url(pointer.webp) 4 5, pointer",
    );
    expect(propertyValue(findCapabilityRule(rules, "avif"), "cursor")).toBe(
      "url(pointer.avif) 4 5, pointer",
    );
    expect(result.css).not.toContain("cursor: none");
  });

  it("keeps a non-shorthand property name byte-for-byte", async () => {
    const result = await transform(`.banner { BACKGROUND-IMAGE: url(banner.png) !important; }`, {
      formats: [{ id: "webp" }],
    });
    const ready = findCapabilityRule(rulesFrom(result), "webp");
    const declaration = declarationsFrom(ready)[0];

    expect(declaration?.prop).toBe("BACKGROUND-IMAGE");
    expect(declaration?.value).toBe("url(banner.webp)");
    expect(declaration?.important).toBe(true);
  });

  it("does not mirror resets, all, gradients, or unrelated image declarations", async () => {
    const result = await transform(`
      .reset { background: none; }
      .wide-reset { all: revert-layer !important; }
      .color { background-color: red; }
      .gradient { background-image: linear-gradient(red, blue); }
      .mask-reset { mask: none; }
      .mask-gradient { mask-image: linear-gradient(black, transparent); }
      .mask-position { mask-position: center; }
      .cursor-keyword { cursor: pointer; }
    `);

    expect(rulesFrom(result)).toHaveLength(8);
    expect(result.css).not.toContain("data-imgcaps");
  });

  it("keeps later non-URL resets outside the generated capability cascade", async () => {
    const result = await transform(`
      .banner { background-image: url(banner.png); }
      .banner { background: none; }
    `);
    const rules = rulesFrom(result);
    const mirrors = rules.filter((rule) => rule.selector.includes("data-imgcaps"));
    const sourceRules = rules.filter((rule) => rule.selector === ".banner");

    expect(mirrors).toHaveLength(3);
    expect(mirrors.every((rule) => declarationsFrom(rule)[0]?.prop === "background-image")).toBe(
      true,
    );
    expect(sourceRules).toHaveLength(2);
    expect(declarationsFrom(sourceRules[0] as Rule)[0]?.value).toBe("none");
    expect(declarationsFrom(sourceRules[1] as Rule)[0]?.value).toBe("none");
  });

  it("leaves nested and dynamic image functions untouched", async () => {
    const result = await transform(`
      .banner {
        background-image: var(--fallback), image-set(url(nested.png) 1x), url(local.png);
      }
      .masked {
        mask-image: image-set(url(nested-mask.png) 1x), url(local-mask.png);
      }
    `);
    const rules = rulesFrom(result);
    const bannerReady = rules.find(
      (rule) => rule.selector.endsWith(" .banner") && capabilityTokens(rule).has("avif"),
    ) as Rule;
    const maskReady = rules.find(
      (rule) => rule.selector.endsWith(" .masked") && capabilityTokens(rule).has("avif"),
    ) as Rule;

    expect(imageValue(bannerReady)).toBe(
      "var(--fallback), image-set(url(nested.png) 1x), url(local.avif)",
    );
    expect(propertyValue(maskReady, "mask-image")).toBe(
      "image-set(url(nested-mask.png) 1x), url(local-mask.avif)",
    );
  });

  it("keeps top-level image functions when reducing a background shorthand", async () => {
    const result = await transform(`
      .banner {
        background: image-set(url(nested.png) 1x) left, url(local.png) right;
      }
    `);
    const rules = rulesFrom(result);
    const original = rules.find((rule) => rule.selector === ".banner") as Rule;
    const ready = findCapabilityRule(rules, "avif");

    expect(declarationsFrom(original)[0]?.value).toBe(
      "image-set(url(nested.png) 1x) left, none right",
    );
    expect(imageValue(ready)).toBe("image-set(url(nested.png) 1x), url(local.avif)");
  });

  it("keeps a combined gate when per-occurrence fallback produces a distinct value", async () => {
    const result = await transform(`.banner { background-image: url(a.png), url(b.png); }`, {
      resolveVariantUrl({ format, originalUrl }) {
        if (format === "avif" && originalUrl === "b.png") {
          return undefined;
        }

        return originalUrl.replace(/\.png$/, `.${format}`);
      },
    });
    const rules = rulesFrom(result);
    const mirrors = rules.filter((rule) => rule.selector.includes("data-imgcaps"));

    expect(mirrors).toHaveLength(4);
    expect(imageValue(findCapabilityRule(rules, "avif"))).toBe("url(a.avif), url(b.png)");
    expect(imageValue(findCapabilityRule(rules, "avif", "webp"))).toBe("url(a.avif), url(b.webp)");
  });

  it("waits for every resolver and falls back after permissive failures", async () => {
    const result = await transform(`.banner { background-image: url(banner.png); }`, {
      resolveVariantUrl({ format }) {
        return format === "avif" ? Promise.reject(new Error("manifest failed")) : undefined;
      },
      strict: false,
    });

    expect(result.warnings()).toHaveLength(1);
    expect(result.warnings()[0]?.text).toContain("manifest failed");
    expect(imageValue(findCapabilityRule(rulesFrom(result)))).toBe("url(banner.png)");
  });

  it("keeps structural failures explicit", async () => {
    await expect(transform(`@import url("theme.css");`)).rejects.toThrow("@import");
    await expect(
      transform(`@keyframes pulse { from { background-image: url(pulse-frame.png); } }`),
    ).rejects.toThrow("keyframes");
    await expect(
      transform(`@keyframes reveal { from { mask-image: url(reveal-mask.png); } }`),
    ).rejects.toThrow("keyframes");
    await expect(
      transform(`.parent { & .child { background: url(child-background.png); } }`),
    ).rejects.toThrow("nesting");
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

function findCapabilityRule(rules: readonly Rule[], ...formats: readonly string[]): Rule {
  const expectedTokens = new Set(["ready", ...formats]);
  const rule = rules.find((candidate) => {
    const actualTokens = capabilityTokens(candidate);

    return (
      actualTokens.size === expectedTokens.size &&
      [...expectedTokens].every((token) => actualTokens.has(token))
    );
  });

  if (rule === undefined) {
    throw new Error(`Missing rule for capability formats: ${formats.join(", ")}`);
  }

  return rule;
}

function capabilityTokens(rule: Rule): ReadonlySet<string> {
  const tokens = new Set<string>();
  const pattern = /\[data-imgcaps~=(?:"([^"]+)"|'([^']+)'|([^\]\s]+))\]/g;

  for (const match of rule.selector.matchAll(pattern)) {
    const token = match[1] ?? match[2] ?? match[3];

    if (token !== undefined) {
      tokens.add(token);
    }
  }

  return tokens;
}

function declarationsFrom(rule: Rule) {
  return rule.nodes.filter((node) => node.type === "decl");
}

function imageValue(rule: Rule): string {
  const declaration = declarationsFrom(rule).find((node) =>
    node.prop.toLowerCase().endsWith("background-image"),
  );

  if (declaration === undefined) {
    throw new Error("Missing background-image declaration");
  }

  return declaration.value;
}

function propertyValue(rule: Rule, property: string): string {
  const declaration = declarationsFrom(rule).find(
    (node) => node.prop.toLowerCase() === property.toLowerCase(),
  );

  if (declaration === undefined) {
    throw new Error(`Missing ${property} declaration`);
  }

  return declaration.value;
}
