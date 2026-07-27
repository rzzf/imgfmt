import type { HighlightedLines, HighlightLanguage } from "./highlight";

export type HighlightTarget = "output" | "snippet";

export interface HighlightRequest {
  readonly code: string;
  readonly language: HighlightLanguage;
  readonly requestId: number;
  readonly target: HighlightTarget;
}

export type HighlightResponse =
  | {
      readonly kind: "failure";
      readonly message: string;
      readonly requestId: number;
      readonly target: HighlightTarget;
    }
  | {
      readonly kind: "success";
      readonly requestId: number;
      readonly target: HighlightTarget;
      readonly tokens: HighlightedLines;
    };
