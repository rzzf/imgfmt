import postcss from "postcss";

import imgfmt from "../../src/postcss";
import type { ImgfmtOptions } from "../../src/types";
import { getFormatPreset, type FormatPresetId } from "./formats";
import { preprocessStylesheet } from "./preprocess";
import type { StylesheetLanguageId } from "./stylesheets";
import type { BuildToolId } from "./tools";

export interface CompileCssInput {
  readonly formatPreset: FormatPresetId;
  readonly inputLanguage: StylesheetLanguageId;
  readonly source: string;
  readonly tool: BuildToolId;
}

export interface CompileCssResult {
  readonly css: string;
  readonly durationMs: number;
  readonly readyRuleCount: number;
  readonly warningCount: number;
}

export async function compileCss(input: CompileCssInput): Promise<CompileCssResult> {
  const preset = getFormatPreset(input.formatPreset);
  const options: ImgfmtOptions = {
    formats: preset.formatIds.map((id) => ({ id })),
  };
  const startedAt = performance.now();
  const source = await preprocessStylesheet(input.source, input.inputLanguage);
  const result = await postcss([imgfmt(options)]).process(source, {
    from: `/playground/${input.tool}/style.css`,
    map: false,
  });
  let readyRuleCount = 0;

  result.root.walkRules((rule) => {
    if (rule.selector.includes("[data-imgcaps")) {
      readyRuleCount += 1;
    }
  });

  return {
    css: result.css,
    durationMs: performance.now() - startedAt,
    readyRuleCount,
    warningCount: result.warnings().length,
  };
}
