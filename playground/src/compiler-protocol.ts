import type { CompileCssResult } from "./compile";
import type { FormatPresetId } from "./formats";
import type { StylesheetLanguageId } from "./stylesheets";
import type { BuildToolId } from "./tools";

export interface CompileRequest {
  readonly formatPreset: FormatPresetId;
  readonly inputLanguage: StylesheetLanguageId;
  readonly requestId: number;
  readonly source: string;
  readonly tool: BuildToolId;
}

export interface CompileSuccessResponse extends CompileCssResult {
  readonly kind: "success";
  readonly requestId: number;
}

export interface CompileFailureResponse {
  readonly column?: number;
  readonly kind: "failure";
  readonly line?: number;
  readonly message: string;
  readonly requestId: number;
  readonly stage: "preprocess" | "transform";
}

export type CompileResponse = CompileFailureResponse | CompileSuccessResponse;
