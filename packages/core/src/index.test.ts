import { describe, expect, it } from "vite-plus/test";

import { isSafeFormatId, parseImageFormatId, selectCandidate } from "./index";

const avif = parseImageFormatId("avif");
const webp = parseImageFormatId("webp");

describe("selectCandidate", () => {
  it("chooses the first supported variant available for this occurrence", () => {
    expect(
      selectCandidate({
        originalUrl: "hero.png",
        variants: [{ format: webp, url: "hero.webp" }],
        preference: [avif, webp],
        capabilities: {
          avif: true,
          webp: true,
        },
      }),
    ).toEqual({
      kind: "variant",
      format: "webp",
      url: "hero.webp",
    });
  });

  it("uses the original when no supported user-provided variant exists", () => {
    expect(
      selectCandidate({
        originalUrl: "hero.png",
        variants: [
          { format: avif, url: "hero.avif" },
          { format: webp, url: "hero.webp" },
        ],
        preference: [avif, webp],
        capabilities: {
          avif: false,
          webp: false,
        },
      }),
    ).toEqual({
      kind: "original",
      format: "original",
      url: "hero.png",
    });
  });

  it("ignores inherited capability properties", () => {
    const capabilities = Object.create({ webp: true }) as Record<string, boolean>;

    expect(
      selectCandidate({
        originalUrl: "hero.png",
        variants: [{ format: webp, url: "hero.webp" }],
        preference: [webp],
        capabilities,
      }),
    ).toEqual({
      kind: "original",
      format: "original",
      url: "hero.png",
    });
  });

  it("rejects duplicate variant formats", () => {
    expect(() =>
      selectCandidate({
        originalUrl: "hero.png",
        variants: [
          { format: webp, url: "hero-a.webp" },
          { format: webp, url: "hero-b.webp" },
        ],
        preference: [webp],
        capabilities: { webp: true },
      }),
    ).toThrow(TypeError);
  });

  it("validates the full preference list before selecting a candidate", () => {
    expect(() =>
      selectCandidate({
        originalUrl: "hero.png",
        variants: [{ format: webp, url: "hero.webp" }],
        preference: [webp, webp],
        capabilities: { webp: true },
      }),
    ).toThrow(TypeError);
  });
});

describe("isSafeFormatId", () => {
  it.each(["webp", "avif", "jpeg-xl"])("accepts %s", (format) => {
    expect(isSafeFormatId(format)).toBe(true);
  });

  it.each([
    "constructor",
    "original",
    "prototype",
    "ready",
    "pending",
    "no-webp",
    "WebP",
    "bad token",
  ])("rejects %s", (format) => {
    expect(isSafeFormatId(format)).toBe(false);
  });
});
