declare const imageFormatIdBrand: unique symbol;

const reservedFormatIds: ReadonlySet<string> = new Set([
  "constructor",
  "original",
  "pending",
  "prototype",
  "ready",
]);

export type ImageFormatId = string & {
  readonly [imageFormatIdBrand]: "ImageFormatId";
};

export type CapabilityVector = Readonly<Record<string, boolean | undefined>>;

export interface ImageVariantUrl {
  readonly format: ImageFormatId;
  /** An opaque CSS or bundler URL supplied by the user. */
  readonly url: string;
}

export interface CandidateSelectionInput {
  readonly originalUrl: string;
  readonly variants: readonly ImageVariantUrl[];
  readonly preference: readonly ImageFormatId[];
  readonly capabilities: CapabilityVector;
}

export interface OriginalSelection {
  readonly kind: "original";
  readonly format: "original";
  readonly url: string;
}

export interface VariantSelection {
  readonly kind: "variant";
  readonly format: ImageFormatId;
  readonly url: string;
}

export type CandidateSelection = OriginalSelection | VariantSelection;

/**
 * Selects per logical occurrence, not per page. A supported format is skipped
 * when this particular source has no user-provided variant for it.
 */
export function selectCandidate(input: CandidateSelectionInput): CandidateSelection {
  if (input.originalUrl.length === 0) {
    throw new TypeError("Original image URL must not be empty");
  }

  const variantsByFormat = new Map<ImageFormatId, string>();

  for (const variant of input.variants) {
    const format = parseImageFormatId(variant.format);

    if (variant.url.length === 0) {
      throw new TypeError(`Variant URL must not be empty: ${format}`);
    }

    if (variantsByFormat.has(format)) {
      throw new TypeError(`Duplicate image variant format: ${format}`);
    }

    variantsByFormat.set(format, variant.url);
  }

  const seenPreferences = new Set<ImageFormatId>();
  const normalizedPreferences: ImageFormatId[] = [];

  for (const preference of input.preference) {
    const format = parseImageFormatId(preference);

    if (seenPreferences.has(format)) {
      throw new TypeError(`Duplicate image format preference: ${format}`);
    }

    seenPreferences.add(format);
    normalizedPreferences.push(format);
  }

  for (const format of normalizedPreferences) {
    const url = variantsByFormat.get(format);

    if (
      Object.hasOwn(input.capabilities, format) &&
      input.capabilities[format] === true &&
      url !== undefined
    ) {
      return {
        kind: "variant",
        format,
        url,
      };
    }
  }

  return {
    kind: "original",
    format: "original",
    url: input.originalUrl,
  };
}

export function isSafeFormatId(value: string): boolean {
  return (
    /^[a-z][a-z0-9-]*$/.test(value) && !reservedFormatIds.has(value) && !value.startsWith("no-")
  );
}

export function parseImageFormatId(value: string): ImageFormatId {
  if (!isSafeFormatId(value)) {
    throw new TypeError(`Invalid image format id: ${value}`);
  }

  return value as ImageFormatId;
}
