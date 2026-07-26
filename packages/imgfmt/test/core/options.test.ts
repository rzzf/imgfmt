import { describe, expect, it } from "vite-plus/test";

import { normalizeOptions, resolveSiblingVariantUrl } from "../../src/options";

describe("normalizeOptions", () => {
  it("defaults to AVIF followed by WebP", () => {
    expect(normalizeOptions().formats.map(({ id }) => id)).toEqual(["avif", "webp"]);
  });

  it("requires probes for custom formats", () => {
    expect(() => normalizeOptions({ formats: [{ id: "example" }] })).toThrow(
      "requires at least one probe",
    );
  });

  it("caps truth-vector expansion", () => {
    const probe = { height: 1, uri: "data:image/example;base64,test", width: 1 };

    expect(() =>
      normalizeOptions({
        formats: ["one", "two", "three", "four", "five"].map((id) => ({
          id,
          probes: [probe],
        })),
      }),
    ).toThrow("At most 4");
  });
});

describe("resolveSiblingVariantUrl", () => {
  it("replaces the path extension while retaining query and fragment suffixes", () => {
    expect(
      resolveSiblingVariantUrl({
        extension: ".avif",
        format: "avif",
        originalUrl: "https://cdn.example/images/hero.large.png?v=1#crop",
      }),
    ).toBe("https://cdn.example/images/hero.large.avif?v=1#crop");
  });

  it.each(["https://cdn.example.com", "//cdn.example.com", "https://cdn.example.com/"])(
    "does not treat an authority as a filename in %s",
    (originalUrl) => {
      expect(
        resolveSiblingVariantUrl({ extension: ".webp", format: "webp", originalUrl }),
      ).toBeUndefined();
    },
  );

  it("appends to dotfiles instead of replacing the whole filename", () => {
    expect(
      resolveSiblingVariantUrl({
        extension: ".webp",
        format: "webp",
        originalUrl: "/images/.hero?theme=dark",
      }),
    ).toBe("/images/.hero.webp?theme=dark");
  });

  it.each(["data:image/png;base64,test", "blob:https://example.test/id", "#fragment"])(
    "leaves non-sibling URL %s unavailable",
    (originalUrl) => {
      expect(
        resolveSiblingVariantUrl({ extension: ".webp", format: "webp", originalUrl }),
      ).toBeUndefined();
    },
  );
});
