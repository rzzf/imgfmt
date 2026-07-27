import { describe, expect, it } from "vite-plus/test";

import { highlightCode } from "../src/highlight";

describe("playground syntax highlighting", () => {
  it("tokenizes CSS without changing user-authored text", async () => {
    const source = `.banner::before {\n  content: "</code><img src=x onerror='alert(1)'>";\n}`;
    const lines = await highlightCode(source, "css");
    const highlightedText = lines
      .map((line) => line.map((token) => token.content).join(""))
      .join("\n");

    expect(highlightedText).toBe(source);
    expect(lines.flat().some((token) => token.color !== undefined)).toBe(true);
  });

  it("tokenizes integration templates as TypeScript", async () => {
    const source = `const options = {
  postcss: "manual" as const,
};`;
    const lines = await highlightCode(source, "typescript");
    const highlightedText = lines
      .map((line) => line.map((token) => token.content).join(""))
      .join("\n");

    expect(highlightedText).toBe(source);
    expect(lines.flat().length).toBeGreaterThan(1);
  });
});
