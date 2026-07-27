import { isSafeFormatId } from "../core";
import { renderBrowserRuntime } from "./source";

export const capabilityAttribute = "data-imgcaps" as const;
export const pendingCapabilityState = "pending" as const;
export const readyCapabilityToken = "ready" as const;
export const defaultProbeDeadlineMs = 500 as const;

export interface ImageProbeDefinition {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface FormatProbeDefinition {
  readonly id: string;
  /** Every probe in the list must decode for the format capability to be true. */
  readonly probes: readonly ImageProbeDefinition[];
}

export interface GenerateRuntimeSourceOptions {
  readonly formats: readonly FormatProbeDefinition[];
  readonly deadlineMs?: number;
}

export interface SerializeCapabilityStateInput {
  readonly formats: readonly string[];
  readonly capabilities: Readonly<Record<string, boolean | undefined>>;
}

/** Modernizr 3.13.1: lossy, static, opaque WebP, 1x1. */
export const webpLossyProbe: ImageProbeDefinition = {
  uri: "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
  width: 1,
  height: 1,
};

/** Modernizr 3.13.1: static, opaque, 8-bit AVIF Baseline, 1x1. */
export const avifBaselineProbe: ImageProbeDefinition = {
  uri: "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAEcbWV0YQAAAAAAAABIaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGNhdmlmIC0gaHR0cHM6Ly9naXRodWIuY29tL2xpbmstdS9jYXZpZgAAAAAeaWxvYwAAAAAEQAABAAEAAAAAAUQAAQAAABcAAAAqaWluZgEAAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFJbWFnZQAAAAAOcGl0bQAAAAAAAQAAAHJpcHJwAAAAUmlwY28AAAAQcGFzcAAAAAEAAAABAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAAFmF2MUOBAAwACggYAAYICGgIIAAAABhpcG1hAAAAAAAAAAEAAQUBAoMDhAAAAB9tZGF0CggYAAYICGgIIBoFHiAAAEQiBACwDoA=",
  width: 1,
  height: 1,
};

export const defaultFormatProbes: readonly FormatProbeDefinition[] = [
  { id: "avif", probes: [avifBaselineProbe] },
  { id: "webp", probes: [webpLossyProbe] },
];

export function serializeCapabilityState(input: SerializeCapabilityStateInput): string {
  if (input.formats.length === 0) {
    throw new TypeError("At least one image format is required");
  }

  const seen = new Set<string>();
  const tokens: string[] = [readyCapabilityToken];

  for (const format of input.formats) {
    assertFormatId(format);

    if (seen.has(format)) {
      throw new TypeError(`Duplicate image format id: ${format}`);
    }

    seen.add(format);

    if (Object.hasOwn(input.capabilities, format) && input.capabilities[format] === true) {
      tokens.push(format);
    }
  }

  return tokens.join(" ");
}

/** Generates the dependency-free classic script shipped to browsers. */
export function generateRuntimeSource(options: GenerateRuntimeSourceOptions): string {
  const deadlineMs = options.deadlineMs ?? defaultProbeDeadlineMs;

  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60_000) {
    throw new RangeError("Probe deadline must be an integer between 1 and 60000 milliseconds");
  }

  const formatIds: string[] = [];
  const flattenedProbes: Array<{
    readonly formatIndex: number;
    readonly height: number;
    readonly uri: string;
    readonly width: number;
  }> = [];
  const seen = new Set<string>();

  for (const [formatIndex, format] of options.formats.entries()) {
    assertFormatId(format.id);

    if (seen.has(format.id)) {
      throw new TypeError(`Duplicate image format id: ${format.id}`);
    }

    if (format.probes.length === 0) {
      throw new TypeError(`Image format must have at least one probe: ${format.id}`);
    }

    seen.add(format.id);
    formatIds.push(format.id);

    for (const probe of format.probes) {
      assertProbe(probe, format.id);
      flattenedProbes.push({
        formatIndex,
        height: probe.height,
        uri: probe.uri,
        width: probe.width,
      });
    }
  }

  if (formatIds.length === 0) {
    throw new TypeError("At least one image format probe is required");
  }

  return renderBrowserRuntime({
    attribute: capabilityAttribute,
    deadlineMs,
    formats: formatIds,
    pending: pendingCapabilityState,
    probes: flattenedProbes,
    ready: readyCapabilityToken,
  });
}

function assertFormatId(value: string): void {
  if (!isSafeFormatId(value)) {
    throw new TypeError(`Invalid image format id: ${value}`);
  }
}

function assertProbe(probe: ImageProbeDefinition, format: string): void {
  if (probe.uri.length === 0) {
    throw new TypeError(`Probe URI must not be empty: ${format}`);
  }

  if (
    !Number.isSafeInteger(probe.width) ||
    probe.width < 1 ||
    !Number.isSafeInteger(probe.height) ||
    probe.height < 1
  ) {
    throw new TypeError(`Probe dimensions must be positive integers: ${format}`);
  }
}
