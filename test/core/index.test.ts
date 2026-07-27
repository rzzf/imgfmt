import { describe, expect, it } from "vite-plus/test";

import { isSafeFormatId, parseImageFormatId, selectCandidate } from "../../src/core";

const avif = parseImageFormatId("avif");
const webp = parseImageFormatId("webp");

describe("selectCandidate", () => {
  it("chooses the first supported variant available for this occurrence", () => {
    expect(
      selectCandidate({
        capabilities: { avif: true, webp: true },
        originalUrl: "background.png",
        preference: [avif, webp],
        variants: [{ format: webp, url: "background.webp" }],
      }),
    ).toEqual({
      format: "webp",
      kind: "variant",
      url: "background.webp",
    });
  });

  it("uses the original when no supported user-provided variant exists", () => {
    expect(
      selectCandidate({
        capabilities: { avif: false, webp: false },
        originalUrl: "background.png",
        preference: [avif, webp],
        variants: [
          { format: avif, url: "background.avif" },
          { format: webp, url: "background.webp" },
        ],
      }),
    ).toEqual({
      format: "original",
      kind: "original",
      url: "background.png",
    });
  });

  it("ignores inherited capability properties", () => {
    const capabilities = Object.create({ webp: true }) as Record<string, boolean>;

    expect(
      selectCandidate({
        capabilities,
        originalUrl: "background.png",
        preference: [webp],
        variants: [{ format: webp, url: "background.webp" }],
      }),
    ).toEqual({
      format: "original",
      kind: "original",
      url: "background.png",
    });
  });

  it("rejects duplicate formats before selecting", () => {
    expect(() =>
      selectCandidate({
        capabilities: { webp: true },
        originalUrl: "background.png",
        preference: [webp, webp],
        variants: [{ format: webp, url: "background.webp" }],
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
