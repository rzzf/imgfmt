export type ImagePropertyFamily =
  | "background"
  | "mask"
  | "border-image"
  | "list-style"
  | "cursor"
  | "content"
  | "shape";

export type DiagnosticSeverity = "warning" | "error";

export interface CssDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

export interface CssDiscoveryOptions {
  readonly strict: boolean;
  readonly propertyFamilies: readonly ImagePropertyFamily[];
}

export interface CssVariantUrlRequest {
  readonly format: string;
  readonly importer: string;
  readonly originalUrl: string;
  readonly property: string;
}

export type CssVariantUrlResolver = (
  request: CssVariantUrlRequest,
) => Promise<string | undefined> | string | undefined;

/**
 * Only these families are planned for the first vertical slice.
 */
export const initialPropertyFamilies: readonly ImagePropertyFamily[] = ["background"];
