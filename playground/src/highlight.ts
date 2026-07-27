import css from "@shikijs/langs/css";
import typescript from "@shikijs/langs/typescript";
import vitesseDark from "@shikijs/themes/vitesse-dark";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export type HighlightLanguage = "css" | "typescript";

export interface HighlightToken {
  readonly color?: string;
  readonly content: string;
  readonly fontStyle?: number;
}

export type HighlightedLines = readonly (readonly HighlightToken[])[];

const theme = "vitesse-dark";
const highlighterPromise = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [css, typescript],
  themes: [vitesseDark],
});

export async function highlightCode(
  code: string,
  language: HighlightLanguage,
): Promise<HighlightedLines> {
  const highlighter = await highlighterPromise;
  const result = highlighter.codeToTokens(code, {
    lang: language,
    theme,
    tokenizeMaxLineLength: 20_000,
    tokenizeTimeLimit: 100,
  });

  return result.tokens.map((line) =>
    line.map((token) => ({
      ...(token.color === undefined ? {} : { color: token.color }),
      content: token.content,
      ...(token.fontStyle === undefined ? {} : { fontStyle: token.fontStyle }),
    })),
  );
}
