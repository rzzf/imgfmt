import { isSafeFormatId } from "./core";

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
    tokens.push(
      Object.hasOwn(input.capabilities, format) && input.capabilities[format] === true
        ? format
        : `no-${format}`,
    );
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
  const flattenedProbes: Array<ImageProbeDefinition & { readonly formatIndex: number }> = [];
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
      flattenedProbes.push({ ...probe, formatIndex });
    }
  }

  if (formatIds.length === 0) {
    throw new TypeError("At least one image format probe is required");
  }

  const formatJson = serializeForClassicScript(formatIds);
  const probeJson = serializeForClassicScript(flattenedProbes);

  return (
    `(function(d,I,setT,clearT){\n` +
    `"use strict";\n` +
    `var attribute="${capabilityAttribute}";\n` +
    `var pending="${pendingCapabilityState}";\n` +
    `var root=d.documentElement;\n` +
    `if(!root||root.getAttribute(attribute)!==pending){return;}\n` +
    `var formats=${formatJson};\n` +
    `var probes=${probeJson};\n` +
    `var capabilities=[];\n` +
    `var settled=[];\n` +
    `var images=[];\n` +
    `var remaining=probes.length;\n` +
    `var committed=false;\n` +
    `var timer=null;\n` +
    `var i;\n` +
    `for(i=0;i<formats.length;i+=1){capabilities[i]=true;}\n` +
    `function dimensionsMatch(image,probe){\n` +
    `var width=typeof image.naturalWidth==="number"?image.naturalWidth:image.width;\n` +
    `var height=typeof image.naturalHeight==="number"?image.naturalHeight:image.height;\n` +
    `return width===probe.width&&height===probe.height;\n` +
    `}\n` +
    `function commit(){\n` +
    `if(committed){return;}\n` +
    `committed=true;\n` +
    `if(timer!==null){clearT(timer);timer=null;}\n` +
    `var tokens=["${readyCapabilityToken}"];\n` +
    `for(var index=0;index<formats.length;index+=1){tokens.push(capabilities[index]?formats[index]:"no-"+formats[index]);}\n` +
    `if(root.getAttribute(attribute)===pending){root.setAttribute(attribute,tokens.join(" "));}\n` +
    `}\n` +
    `function settle(index,supported){\n` +
    `if(committed||settled[index]){return;}\n` +
    `settled[index]=true;\n` +
    `remaining-=1;\n` +
    `var image=images[index];\n` +
    `if(image){image.onload=null;image.onerror=null;image.onabort=null;images[index]=null;}\n` +
    `if(!supported){capabilities[probes[index].formatIndex]=false;}\n` +
    `if(remaining===0){commit();}\n` +
    `}\n` +
    `function startProbe(index){\n` +
    `var probe=probes[index];\n` +
    `var image;\n` +
    `try{\n` +
    `image=new I();\n` +
    `images[index]=image;\n` +
    `image.onload=function(){settle(index,dimensionsMatch(image,probe));};\n` +
    `image.onerror=image.onabort=function(){settle(index,false);};\n` +
    `image.src=probe.uri;\n` +
    `}catch(error){settle(index,false);}\n` +
    `}\n` +
    `function onDeadline(){\n` +
    `for(var index=0;index<probes.length;index+=1){\n` +
    `if(!settled[index]){settle(index,false);}\n` +
    `}\n` +
    `}\n` +
    `timer=setT(onDeadline,${deadlineMs});\n` +
    `for(i=0;i<probes.length;i+=1){startProbe(i);}\n` +
    `})(document,Image,setTimeout,clearTimeout);\n`
  );
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

function serializeForClassicScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
