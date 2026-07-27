import type { Declaration } from "postcss";

import type { CapabilityVector } from "../core";
import type { NormalizedFormatOptions } from "../core/options";

export interface ImageValueProperty {
  readonly generatedProperty?: string;
  readonly layerName?: "background" | "mask";
  readonly sourceBehavior: "remove-declaration" | "suppress-urls";
}

export interface OccurrencePlan {
  readonly declaration: Declaration;
  readonly functionEnd: number;
  readonly functionStart: number;
  readonly originalUrl: string;
  readonly urlEnd: number;
  readonly urlStart: number;
  readonly variants: Map<string, string>;
}

export interface DeclarationPlan {
  readonly declaration: Declaration;
  readonly occurrences: readonly OccurrencePlan[];
}

export interface ReadyState {
  readonly capabilities: CapabilityVector;
  readonly mask: number;
  readonly tokens: readonly string[];
}

export interface EmittedReadyState {
  readonly declarationSignature: string;
  readonly mask: number;
  readonly supportedCount: number;
}

export interface ResolutionJob {
  readonly format: NormalizedFormatOptions;
  readonly occurrence: OccurrencePlan;
}

export interface CssCompilerOptions {
  /** The host guarantees that every imported CSS module runs through imgfmt. */
  readonly allowImports?: boolean;
}

export type ProcessCssModuleOptions = CssCompilerOptions;

export interface VitePostcssOptions {
  plugins?: unknown[];
}

export interface ViteCssOptions {
  postcss?: string | VitePostcssOptions;
  transformer?: string;
}

export interface ViteUserConfig {
  css?: ViteCssOptions;
  root?: string;
}
