export interface ImgfmtImageProbe {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface ImgfmtFormatOptions {
  readonly id: string;
  /**
   * Filename extension used by the default sibling-URL convention. imgfmt
   * does not create or validate the referenced file.
   */
  readonly extension?: string;
  /** Required for custom formats; AVIF and WebP have built-in probes. */
  readonly probes?: readonly ImgfmtImageProbe[];
}

export interface ImgfmtVariantUrlRequest {
  readonly originalUrl: string;
  readonly format: string;
  readonly extension: string;
  readonly importer?: string;
  readonly property?: string;
}

export type ImgfmtVariantUrlResolver = (
  request: ImgfmtVariantUrlRequest,
) => Promise<string | undefined> | string | undefined;

export interface ImgfmtOptions {
  /** Preferred format order. Defaults to AVIF followed by WebP. */
  readonly formats?: readonly ImgfmtFormatOptions[];
  readonly probeDeadlineMs?: number;
  /** Let the Vite adapter install PostCSS, or manage imgfmt/postcss yourself. */
  readonly postcss?: "auto" | "manual";
  /** Override the default sibling-URL convention with opaque user URLs. */
  readonly resolveVariantUrl?: ImgfmtVariantUrlResolver;
  /** Treat resolver failures as build errors. Structural CSS failures are always fatal. */
  readonly strict?: boolean;
}
