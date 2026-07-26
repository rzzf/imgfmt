export interface ImgfmtImageProbe {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface ImgfmtFormatOptions {
  readonly id: string;
  /**
   * Filename extension used by the default sibling-URL convention. It does
   * not imply that imgfmt creates or validates the referenced file.
   */
  readonly extension?: string;
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
  readonly formats?: readonly ImgfmtFormatOptions[];
  readonly probeDeadlineMs?: number;
  /** Override the default sibling-URL convention with opaque user URLs. */
  readonly resolveVariantUrl?: ImgfmtVariantUrlResolver;
  readonly strict?: boolean;
}
