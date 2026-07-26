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

export interface ImgfmtDocumentFile {
  /** HTML source path, resolved from the host build root. */
  readonly input: string;
  /** Relative output path. Defaults to the input basename. */
  readonly output?: string;
}

export interface ImgfmtDocumentManifest {
  readonly runtimeFileName: string;
  install(html: string, htmlOutput: string): string;
  runtimeUrlFor(htmlOutput: string): string;
}

export interface ImgfmtStaticDocumentIntegration {
  readonly mode: "static";
  readonly files: readonly (ImgfmtDocumentFile | string)[];
}

export interface ImgfmtManualDocumentIntegration {
  readonly mode: "manual";
  readonly onManifest: (manifest: ImgfmtDocumentManifest) => Promise<void> | void;
  readonly watchFiles?: readonly string[];
}

export type ImgfmtDocumentIntegration =
  | ImgfmtManualDocumentIntegration
  | ImgfmtStaticDocumentIntegration;

export interface ImgfmtOptions {
  /**
   * Explicit document ownership for hosts such as esbuild that do not have
   * an HTML pipeline. Hosts with a native document hook reject this option.
   */
  readonly document?: ImgfmtDocumentIntegration;
  /** Preferred format order. Defaults to AVIF followed by WebP. */
  readonly formats?: readonly ImgfmtFormatOptions[];
  readonly probeDeadlineMs?: number;
  /** Let a capable host adapter transform CSS, or install imgfmt/postcss yourself. */
  readonly postcss?: "auto" | "manual";
  /** Override the default sibling-URL convention with opaque user URLs. */
  readonly resolveVariantUrl?: ImgfmtVariantUrlResolver;
  /** Treat resolver failures as build errors. Structural CSS failures are always fatal. */
  readonly strict?: boolean;
}
