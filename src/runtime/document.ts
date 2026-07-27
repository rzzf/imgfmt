import { basename, isAbsolute, posix, resolve } from "node:path";

import { capabilityAttribute, pendingCapabilityState } from ".";
import type { ImgfmtDocumentFile } from "../types";

export const runtimeMarkerAttribute = "data-imgfmt-runtime" as const;

const rawTextElements: ReadonlySet<string> = new Set([
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

interface HtmlAttribute {
  readonly name: string;
  readonly value?: string | undefined;
}

interface HtmlOpeningTag {
  readonly attributes: readonly HtmlAttribute[];
  readonly end: number;
  readonly name: string;
  readonly start: number;
}

export interface ResolvedDocumentFile {
  readonly input: string;
  readonly output: string;
}

export function resolveDocumentFiles(
  files: readonly (ImgfmtDocumentFile | string)[],
  root: string,
): readonly ResolvedDocumentFile[] {
  if (files.length === 0) {
    throw new TypeError("At least one imgfmt document file is required");
  }

  const outputs = new Set<string>();

  return files.map((file): ResolvedDocumentFile => {
    const input = typeof file === "string" ? file : file.input;

    if (input.trim().length === 0) {
      throw new TypeError("imgfmt document input must not be empty");
    }

    const requestedOutput =
      typeof file === "string" ? basename(file) : (file.output ?? basename(input));
    const portableOutput = requestedOutput.replaceAll("\\", "/");
    const output = posix.normalize(portableOutput);

    if (
      requestedOutput.trim().length === 0 ||
      isAbsolute(requestedOutput) ||
      /^[a-z]:\//i.test(portableOutput) ||
      output === "." ||
      output === ".." ||
      output.startsWith("../") ||
      !output.toLowerCase().endsWith(".html")
    ) {
      throw new TypeError(`Invalid imgfmt document output path: ${requestedOutput}`);
    }

    if (outputs.has(output)) {
      throw new TypeError(`Duplicate imgfmt document output path: ${output}`);
    }

    outputs.add(output);
    return {
      input: isAbsolute(input) ? input : resolve(root, input),
      output,
    };
  });
}

export function injectPendingCapabilityState(html: string): string {
  const openingTag = findOpeningTag(html, "html");
  const capabilityAttributes = openingTag.attributes.filter(
    (attribute) => attribute.name.toLowerCase() === capabilityAttribute,
  );

  if (
    capabilityAttributes.length > 1 ||
    (capabilityAttributes.length === 1 && capabilityAttributes[0]?.value !== pendingCapabilityState)
  ) {
    throw new Error(`imgfmt owns the ${capabilityAttribute} attribute on <html>`);
  }

  if (capabilityAttributes.length === 1) {
    return html;
  }

  const source = html.slice(openingTag.start, openingTag.end);
  const replacement = source.replace(
    /^<html/i,
    (tagName) => `${tagName} ${capabilityAttribute}="${pendingCapabilityState}"`,
  );
  return `${html.slice(0, openingTag.start)}${replacement}${html.slice(openingTag.end)}`;
}

export function injectDocumentBootstrap(html: string, runtimeSource: string): string {
  assertInlineRuntimeSource(runtimeSource);

  const pendingHtml = injectPendingCapabilityState(html);
  assertRuntimeMarkerAvailable(pendingHtml);

  const head = findOpeningTag(pendingHtml, "head");
  const script = `<script ${runtimeMarkerAttribute}>${runtimeSource}</script>`;
  const transformed = `${pendingHtml.slice(0, head.end)}${script}${pendingHtml.slice(head.end)}`;
  assertDocumentBootstrap(transformed, runtimeSource);
  return transformed;
}

export function assertRuntimeMarkerAvailable(html: string): void {
  const runtimeTags = readOpeningTags(html).filter((tag) =>
    tag.attributes.some((attribute) => attribute.name.toLowerCase() === runtimeMarkerAttribute),
  );

  if (runtimeTags.length !== 0) {
    throw new Error(`imgfmt owns the ${runtimeMarkerAttribute} attribute`);
  }
}

export function assertDocumentBootstrap(html: string, runtimeSource: string): void {
  assertInlineRuntimeSource(runtimeSource);

  const htmlTag = findOpeningTag(html, "html");
  const capabilityAttributes = htmlTag.attributes.filter(
    (attribute) => attribute.name.toLowerCase() === capabilityAttribute,
  );

  if (
    capabilityAttributes.length !== 1 ||
    capabilityAttributes[0]?.value !== pendingCapabilityState
  ) {
    throw new Error(
      `imgfmt expected one ${capabilityAttribute}="${pendingCapabilityState}" attribute`,
    );
  }

  const runtimeTags = readOpeningTags(html).filter((tag) =>
    tag.attributes.some((attribute) => attribute.name.toLowerCase() === runtimeMarkerAttribute),
  );

  if (runtimeTags.length !== 1 || runtimeTags[0]?.name.toLowerCase() !== "script") {
    throw new Error(`imgfmt expected one ${runtimeMarkerAttribute} script`);
  }

  const attributes = runtimeTags[0].attributes;
  const attributesByName = new Map(
    attributes.map((attribute) => [attribute.name.toLowerCase(), attribute]),
  );

  if (
    attributesByName.has("async") ||
    attributesByName.has("defer") ||
    attributesByName.has("nomodule") ||
    attributesByName.has("type") ||
    attributesByName.has("src")
  ) {
    throw new Error("imgfmt runtime must be one inline classic script");
  }

  if (readRawTextContent(html, runtimeTags[0]) !== runtimeSource) {
    throw new Error("imgfmt inline runtime source was altered");
  }
}

export function decodeHtmlAssetSource(source: string | Uint8Array): string {
  return typeof source === "string"
    ? source
    : new TextDecoder("utf-8", { fatal: true }).decode(source);
}

function findOpeningTag(html: string, expectedName: string): HtmlOpeningTag {
  const tag = readOpeningTags(html).find(
    (candidate) => candidate.name.toLowerCase() === expectedName,
  );

  if (tag === undefined) {
    throw new Error(
      `imgfmt requires a <${expectedName}> element to install its document bootstrap`,
    );
  }

  return tag;
}

function readOpeningTags(html: string): readonly HtmlOpeningTag[] {
  const tags: HtmlOpeningTag[] = [];
  const lowerHtml = html.toLowerCase();
  let index = 0;

  while (index < html.length) {
    if (html.startsWith("<!--", index)) {
      const commentEnd = html.indexOf("-->", index + 4);

      if (commentEnd === -1) {
        throw new Error("imgfmt found an unclosed HTML comment");
      }

      index = commentEnd + 3;
      continue;
    }

    if (html[index] !== "<" || /[!/?]/.test(html[index + 1] ?? "")) {
      index += 1;
      continue;
    }

    const nameStart = index + 1;
    let cursor = nameStart;

    while (/[A-Za-z0-9:-]/.test(html[cursor] ?? "")) {
      cursor += 1;
    }

    if (cursor === nameStart || !/[\s/>]/.test(html[cursor] ?? "")) {
      index += 1;
      continue;
    }

    const name = html.slice(nameStart, cursor);
    let quote: '"' | "'" | undefined;
    let end = cursor;

    for (; end < html.length; end += 1) {
      const character = html[end];

      if (quote !== undefined) {
        if (character === quote) {
          quote = undefined;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        end += 1;
        break;
      }
    }

    if (end > html.length || html[end - 1] !== ">") {
      throw new Error(`imgfmt found an unclosed <${name}> element`);
    }

    const source = html.slice(index, end);
    tags.push({
      attributes: readHtmlAttributes(source, name),
      end,
      name,
      start: index,
    });
    index = end;

    const normalizedName = name.toLowerCase();

    if (rawTextElements.has(normalizedName)) {
      index = findRawTextElementEnd(lowerHtml, normalizedName, index);
    }
  }

  return tags;
}

function findRawTextElementEnd(html: string, tagName: string, start: number): number {
  const closingStart = findRawTextElementClosingStart(html, tagName, start);

  if (closingStart === -1) {
    return html.length;
  }

  const closingEnd = html.indexOf(">", closingStart + tagName.length + 2);
  return closingEnd === -1 ? html.length : closingEnd + 1;
}

function findRawTextElementClosingStart(html: string, tagName: string, start: number): number {
  const closingPrefix = `</${tagName}`;
  let closingStart = html.indexOf(closingPrefix, start);

  while (closingStart !== -1) {
    const suffix = html[closingStart + closingPrefix.length];

    if (suffix === ">" || /\s/.test(suffix ?? "")) {
      return closingStart;
    }

    closingStart = html.indexOf(closingPrefix, closingStart + closingPrefix.length);
  }

  return -1;
}

function readHtmlAttributes(openingTag: string, tagName: string): readonly HtmlAttribute[] {
  const attributes: HtmlAttribute[] = [];
  let index = tagName.length + 1;

  while (index < openingTag.length) {
    while (/\s/.test(openingTag[index] ?? "")) {
      index += 1;
    }

    if (openingTag[index] === ">" || openingTag.startsWith("/>", index)) {
      break;
    }

    const nameStart = index;

    while (index < openingTag.length && !/[\s=/>]/.test(openingTag[index] ?? "")) {
      index += 1;
    }

    if (index === nameStart) {
      throw new Error(`imgfmt could not parse the <${tagName}> attributes safely`);
    }

    const name = openingTag.slice(nameStart, index);

    while (/\s/.test(openingTag[index] ?? "")) {
      index += 1;
    }

    if (openingTag[index] !== "=") {
      attributes.push({ name });
      continue;
    }

    index += 1;

    while (/\s/.test(openingTag[index] ?? "")) {
      index += 1;
    }

    const quote = openingTag[index];

    if (quote === '"' || quote === "'") {
      const valueStart = ++index;

      while (index < openingTag.length && openingTag[index] !== quote) {
        index += 1;
      }

      if (openingTag[index] !== quote) {
        throw new Error(`imgfmt found an unclosed <${tagName}> attribute value`);
      }

      attributes.push({ name, value: openingTag.slice(valueStart, index) });
      index += 1;
      continue;
    }

    const valueStart = index;

    while (index < openingTag.length && !/[\s>]/.test(openingTag[index] ?? "")) {
      index += 1;
    }

    attributes.push({ name, value: openingTag.slice(valueStart, index) });
  }

  return attributes;
}

function readRawTextContent(html: string, tag: HtmlOpeningTag): string {
  const closingStart = findRawTextElementClosingStart(
    html.toLowerCase(),
    tag.name.toLowerCase(),
    tag.end,
  );

  if (closingStart === -1) {
    throw new Error(`imgfmt found an unclosed <${tag.name}> element`);
  }

  return html.slice(tag.end, closingStart);
}

function assertInlineRuntimeSource(runtimeSource: string): void {
  if (runtimeSource.length === 0) {
    throw new TypeError("imgfmt inline runtime source must not be empty");
  }

  if (/<\/script[\s>]/i.test(runtimeSource)) {
    throw new TypeError("imgfmt inline runtime source must not close its script element");
  }
}
