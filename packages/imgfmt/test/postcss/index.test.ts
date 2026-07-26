import postcss, { type Result, type Rule } from "postcss";
import { describe, expect, it } from "vite-plus/test";

import imgfmt from "../../src/postcss";

describe("imgfmt/postcss", () => {
  it("creates one exact-one rule for every complete capability state", async () => {
    const result = await transform(`
      .hero, html.theme .hero {
        background-color: #000;
        background-image: linear-gradient(#0008, #0000), url( "./hero.png?x=1#top" );
        background-position: center;
      }
    `);
    const rules = rulesFrom(result);

    expect(rules).toHaveLength(5);
    expect(rules.at(-1)?.selector).toBe(".hero, html.theme .hero");

    const original = rules.at(-1) as Rule;
    expect(imageValue(original)).toBe("linear-gradient(#0008, #0000), none");

    expect(imageValue(findRule(rules, "data-imgcaps~=no-avif", "data-imgcaps~=no-webp"))).toBe(
      'linear-gradient(#0008, #0000), url( "./hero.png?x=1#top" )',
    );
    expect(imageValue(findRule(rules, "data-imgcaps~=no-avif", "data-imgcaps~=webp"))).toBe(
      'linear-gradient(#0008, #0000), url( "./hero.webp?x=1#top" )',
    );
    expect(imageValue(findRule(rules, "data-imgcaps~=avif", "data-imgcaps~=webp"))).toBe(
      'linear-gradient(#0008, #0000), url( "./hero.avif?x=1#top" )',
    );
  });

  it("preserves URL quoting and spacing while replacing only the payload suffix", async () => {
    const calls: string[] = [];
    const result = await transform(
      `.card { background-image: url(a.png), url( 'b.png' ), url("hero\\20 image.png?x=1#top"); }`,
      {
        resolveVariantUrl(request) {
          calls.push(`${request.originalUrl}:${request.format}`);
          return request.originalUrl.replace(/\.png(?=[?#]|$)/, request.extension);
        },
      },
    );
    const ready = findRule(rulesFrom(result), "data-imgcaps~=avif", "data-imgcaps~=webp");

    expect(calls).toEqual([
      "a.png:avif",
      "a.png:webp",
      "b.png:avif",
      "b.png:webp",
      String.raw`hero\20 image.png?x=1#top:avif`,
      String.raw`hero\20 image.png?x=1#top:webp`,
    ]);
    expect(imageValue(ready)).toBe(
      String.raw`url(a.avif), url( 'b.avif' ), url("hero\20 image.avif?x=1#top")`,
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
    const ready = findRule(rules, "data-imgcaps~=avif", "data-imgcaps~=webp");

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

  it("reduces background shorthand to the smallest image property", async () => {
    const result = await transform(`
      .hero {
        color: white;
        background: url('./hero.png') 50% / cover no-repeat, linear-gradient(red, blue) center;
      }
    `);
    const rules = rulesFrom(result);
    const mirrors = rules.filter((rule) => rule.selector.endsWith(" .hero"));
    const original = rules.find((rule) => rule.selector === ".hero");

    expect(mirrors).toHaveLength(4);
    expect(
      mirrors.every((rule) =>
        declarationsFrom(rule).every((declaration) => declaration.prop === "background-image"),
      ),
    ).toBe(true);
    expect(imageValue(findRule(mirrors, "data-imgcaps~=avif", "data-imgcaps~=webp"))).toBe(
      "url('./hero.avif'), linear-gradient(red, blue)",
    );
    expect(declarationsFrom(original as Rule).map(({ prop }) => prop)).toEqual([
      "color",
      "background",
    ]);
    expect(declarationsFrom(original as Rule)[1]?.value).toBe(
      "none 50% / cover no-repeat, linear-gradient(red, blue) center",
    );
  });

  it("keeps a non-shorthand property name byte-for-byte", async () => {
    const result = await transform(`.hero { BACKGROUND-IMAGE: url(hero.png) !important; }`, {
      formats: [{ id: "webp" }],
    });
    const ready = findRule(rulesFrom(result), "data-imgcaps~=webp");
    const declaration = declarationsFrom(ready)[0];

    expect(declaration?.prop).toBe("BACKGROUND-IMAGE");
    expect(declaration?.value).toBe("url(hero.webp)");
    expect(declaration?.important).toBe(true);
  });

  it("does not mirror resets, all, gradients, or unrelated background declarations", async () => {
    const result = await transform(`
      .reset { background: none; }
      .wide-reset { all: revert-layer !important; }
      .color { background-color: red; }
      .gradient { background-image: linear-gradient(red, blue); }
    `);

    expect(rulesFrom(result)).toHaveLength(4);
    expect(result.css).not.toContain("data-imgcaps");
  });

  it("keeps later non-URL resets outside the generated capability cascade", async () => {
    const result = await transform(`
      .hero { background-image: url(hero.png); }
      .hero { background: none; }
    `);
    const rules = rulesFrom(result);
    const mirrors = rules.filter((rule) => rule.selector.includes("data-imgcaps"));
    const sourceRules = rules.filter((rule) => rule.selector === ".hero");

    expect(mirrors).toHaveLength(4);
    expect(mirrors.every((rule) => declarationsFrom(rule)[0]?.prop === "background-image")).toBe(
      true,
    );
    expect(sourceRules).toHaveLength(2);
    expect(declarationsFrom(sourceRules[0] as Rule)[0]?.value).toBe("none");
    expect(declarationsFrom(sourceRules[1] as Rule)[0]?.value).toBe("none");
  });

  it("leaves nested and dynamic image functions untouched", async () => {
    const result = await transform(`
      .hero {
        background-image: var(--fallback), image-set(url(nested.png) 1x), url(local.png);
      }
    `);
    const ready = findRule(rulesFrom(result), "data-imgcaps~=avif", "data-imgcaps~=webp");

    expect(imageValue(ready)).toBe(
      "var(--fallback), image-set(url(nested.png) 1x), url(local.avif)",
    );
  });

  it("keeps top-level image functions when reducing a background shorthand", async () => {
    const result = await transform(`
      .hero {
        background: image-set(url(nested.png) 1x) left, url(local.png) right;
      }
    `);
    const rules = rulesFrom(result);
    const original = rules.find((rule) => rule.selector === ".hero") as Rule;
    const ready = findRule(rules, "data-imgcaps~=avif", "data-imgcaps~=webp");

    expect(declarationsFrom(original)[0]?.value).toBe(
      "image-set(url(nested.png) 1x) left, none right",
    );
    expect(imageValue(ready)).toBe("image-set(url(nested.png) 1x), url(local.avif)");
  });

  it("waits for every resolver and falls back after permissive failures", async () => {
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

  it("keeps structural failures explicit", async () => {
    await expect(transform(`@import url("theme.css");`)).rejects.toThrow("@import");
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
