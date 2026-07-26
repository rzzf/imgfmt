import { parseImageFormatId, type ImageFormatId } from "./core";
import { defaultFormatProbes, defaultProbeDeadlineMs, type FormatProbeDefinition } from "./runtime";
import type { ImgfmtFormatOptions, ImgfmtOptions, ImgfmtVariantUrlResolver } from "./types";

export const maximumFormatCount = 4 as const;

export interface NormalizedFormatOptions extends FormatProbeDefinition {
  readonly id: ImageFormatId;
  readonly extension: string;
}

export interface NormalizedImgfmtOptions {
  readonly formats: readonly NormalizedFormatOptions[];
  readonly probeDeadlineMs: number;
  readonly resolveVariantUrl: ImgfmtVariantUrlResolver;
  readonly strict: boolean;
}

export function normalizeOptions(options: ImgfmtOptions = {}): NormalizedImgfmtOptions {
  const sourceFormats: readonly ImgfmtFormatOptions[] =
    options.formats ??
    defaultFormatProbes.map(
      (format): ImgfmtFormatOptions => ({
        id: format.id,
      }),
    );

  if (sourceFormats.length === 0) {
    throw new TypeError("At least one image format is required");
  }

  if (sourceFormats.length > maximumFormatCount) {
    throw new RangeError(`At most ${maximumFormatCount} image formats are supported`);
  }

  const seen = new Set<ImageFormatId>();
  const formats: NormalizedFormatOptions[] = [];

  for (const sourceFormat of sourceFormats) {
    const id = parseImageFormatId(sourceFormat.id);

    if (seen.has(id)) {
      throw new TypeError(`Duplicate image format id: ${id}`);
    }

    seen.add(id);
    const extension = sourceFormat.extension ?? `.${id}`;

    if (!/^\.[a-z0-9][a-z0-9.-]*$/i.test(extension)) {
      throw new TypeError(`Invalid image format extension: ${extension}`);
    }

    const builtIn = defaultFormatProbes.find((format) => format.id === id);
    const probes = sourceFormat.probes ?? builtIn?.probes;

    if (probes === undefined || probes.length === 0) {
      throw new TypeError(`Custom image format requires at least one probe: ${id}`);
    }

    formats.push({
      id,
      extension,
      probes: probes.map((probe) => ({ ...probe })),
    });
  }

  const probeDeadlineMs = options.probeDeadlineMs ?? defaultProbeDeadlineMs;

  if (!Number.isSafeInteger(probeDeadlineMs) || probeDeadlineMs < 1 || probeDeadlineMs > 60_000) {
    throw new RangeError("Probe deadline must be an integer between 1 and 60000 milliseconds");
  }

  return {
    formats,
    probeDeadlineMs,
    resolveVariantUrl: options.resolveVariantUrl ?? resolveSiblingVariantUrl,
    strict: options.strict ?? true,
  };
}

export function resolveSiblingVariantUrl(
  request: Parameters<ImgfmtVariantUrlResolver>[0],
): string | undefined {
  const originalUrl = request.originalUrl;

  if (/^(?:data|blob):/i.test(originalUrl) || originalUrl.startsWith("#")) {
    return undefined;
  }

  const queryIndex = originalUrl.search(/[?#]/);
  const path = queryIndex === -1 ? originalUrl : originalUrl.slice(0, queryIndex);
  const suffix = queryIndex === -1 ? "" : originalUrl.slice(queryIndex);
  const authority = path.match(/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/\\]*/i)?.[0] ?? "";
  const pathname = path.slice(authority.length);

  if (
    authority.length === 0 &&
    /^[a-z][a-z0-9+.-]*:/i.test(pathname) &&
    !/^[a-z]:[/\\]/i.test(pathname)
  ) {
    return undefined;
  }

  const slashIndex = Math.max(pathname.lastIndexOf("/"), pathname.lastIndexOf("\\"));

  if (pathname.length === 0 || pathname.endsWith("/") || pathname.endsWith("\\")) {
    return undefined;
  }

  const extensionIndex = pathname.lastIndexOf(".");
  const stem = extensionIndex > slashIndex + 1 ? pathname.slice(0, extensionIndex) : pathname;
  return `${authority}${stem}${request.extension}${suffix}`;
}
