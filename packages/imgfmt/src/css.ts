import type { AtRule, Declaration, Node, PluginCreator, Result, Root, Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";

import { selectCandidate, type CapabilityVector, type ImageVariantUrl } from "./core";
import { normalizeOptions, type NormalizedFormatOptions } from "./options";
import { capabilityAttribute } from "./runtime";
import type { ImgfmtOptions, ImgfmtVariantUrlRequest } from "./types";

const pluginName = "imgfmt";

const backgroundLonghands = [
  "background-attachment",
  "background-clip",
  "background-color",
  "background-image",
  "background-origin",
  "background-position",
  "background-position-block",
  "background-position-inline",
  "background-position-x",
  "background-position-y",
  "background-repeat",
  "background-repeat-block",
  "background-repeat-inline",
  "background-repeat-x",
  "background-repeat-y",
  "background-size",
] as const;

const controlledProperties: ReadonlySet<string> = new Set([
  "all",
  "background",
  ...backgroundLonghands,
]);

const imageValueProperties: ReadonlySet<string> = new Set(["background", "background-image"]);
const allowedContainerAtRules: ReadonlySet<string> = new Set([
  "container",
  "layer",
  "media",
  "supports",
]);
const unsupportedDynamicFunctions: ReadonlySet<string> = new Set([
  "-webkit-cross-fade",
  "-webkit-image-set",
  "attr",
  "cross-fade",
  "element",
  "env",
  "first-valid",
  "if",
  "image",
  "image-set",
  "paint",
  "random-item",
  "toggle",
  "var",
]);

interface OccurrencePlan {
  readonly declaration: Declaration;
  readonly end: number;
  readonly originalUrl: string;
  readonly start: number;
  readonly variants: Map<string, string>;
}

interface DeclarationPlan {
  readonly declaration: Declaration;
  readonly occurrences: readonly OccurrencePlan[];
}

interface ReadyState {
  readonly capabilities: CapabilityVector;
  readonly tokens: readonly string[];
}

interface PendingState {
  readonly tokens: readonly string[];
}

type MirrorState =
  | { readonly kind: "pending"; readonly state: PendingState }
  | {
      readonly kind: "ready";
      readonly state: ReadyState;
    };

class UnsupportedCssError extends Error {}

export const postcssPlugin: PluginCreator<ImgfmtOptions> = (inputOptions = {}) => {
  const options = normalizeOptions(inputOptions);

  return {
    postcssPlugin: pluginName,
    async Once(root, { result }): Promise<void> {
      await transformCss(root, result, options);
    },
  };
};

postcssPlugin.postcss = true;

async function transformCss(
  root: Root,
  result: Result,
  options: ReturnType<typeof normalizeOptions>,
): Promise<void> {
  reportRemainingImports(root, result);

  const declarationPlans = new Map<Declaration, DeclarationPlan>();
  const eligibleRules: Rule[] = [];

  root.walkRules((rule) => {
    const declarations = directControlledDeclarations(rule);

    if (declarations.length === 0) {
      return;
    }

    const contextProblem = findUnsupportedContext(rule);

    if (contextProblem !== undefined) {
      report(result, rule, "unsupported-context", contextProblem, true);
      return;
    }

    try {
      gateSelector(rule.selector, pendingTokens(options.formats.length));
    } catch (error) {
      report(
        result,
        rule,
        "unsupported-selector",
        error instanceof Error ? error.message : "The selector cannot be gated safely",
        true,
      );
      return;
    }

    let ruleIsSupported = true;

    for (const declaration of declarations) {
      if (
        normalizeCssIdentifier(declaration.prop) === "all" &&
        !isCssWideKeyword(declaration.value)
      ) {
        report(
          result,
          declaration,
          "unsupported-all-value",
          "Only CSS-wide values can be mirrored from the all property",
          true,
        );
        ruleIsSupported = false;
        continue;
      }

      if (!imageValueProperties.has(normalizeCssIdentifier(declaration.prop))) {
        continue;
      }

      try {
        const occurrences = discoverOccurrences(declaration);

        if (occurrences.length > 0) {
          declarationPlans.set(declaration, { declaration, occurrences });
        }
      } catch (error) {
        report(
          result,
          declaration,
          "unsupported-image-value",
          error instanceof Error ? error.message : "The image value cannot be transformed safely",
          true,
        );
        ruleIsSupported = false;
      }
    }

    if (ruleIsSupported) {
      eligibleRules.push(rule);
    } else {
      for (const declaration of declarations) {
        declarationPlans.delete(declaration);
      }
    }
  });

  await resolveVariants(declarationPlans, result, options);

  const states: readonly MirrorState[] = [
    { kind: "pending", state: { tokens: pendingTokens(options.formats.length) } },
    ...enumerateReadyStates(options.formats).map(
      (state): MirrorState => ({ kind: "ready", state }),
    ),
  ];

  for (const rule of eligibleRules) {
    for (const state of states) {
      rule.before(createMirror(rule, state, declarationPlans, options.formats));
    }
  }
}

function directControlledDeclarations(rule: Rule): Declaration[] {
  const declarations: Declaration[] = [];

  for (const node of rule.nodes) {
    if (node.type === "decl" && controlledProperties.has(normalizeCssIdentifier(node.prop))) {
      declarations.push(node);
    }
  }

  return declarations;
}

function findUnsupportedContext(rule: Rule): string | undefined {
  if (rule.nodes.some((node) => node.type === "rule" || node.type === "atrule")) {
    return "Native CSS nesting must be expanded before imgfmt runs";
  }

  let parent = rule.parent;

  while (parent !== undefined && parent.type !== "root") {
    if (parent.type === "rule") {
      return "Native CSS nesting must be expanded before imgfmt runs";
    }

    if (parent.type === "atrule") {
      const name = normalizeAtRuleName(parent);

      if (name.endsWith("keyframes")) {
        return "Background images inside keyframes are not supported";
      }

      if (name === "scope") {
        return "Selectors inside @scope are not supported";
      }

      if (name === "starting-style") {
        return "@starting-style is not supported";
      }

      if (!allowedContainerAtRules.has(name)) {
        return `Rules inside @${parent.name} are not supported`;
      }
    }

    parent = parent.parent;
  }

  return undefined;
}

function reportRemainingImports(root: Root, result: Result): void {
  root.walkAtRules((atRule) => {
    if (normalizeAtRuleName(atRule) !== "import") {
      return;
    }

    report(
      result,
      atRule,
      "unresolved-import",
      "@import must be resolved by the host before imgfmt runs",
      true,
    );
  });
}

function report(result: Result, node: Node, code: string, message: string, strict: boolean): void {
  const fullMessage = `[${code}] ${message}`;

  if (strict) {
    throw node.error(fullMessage, { plugin: pluginName });
  }

  result.warn(fullMessage, { node, plugin: pluginName });
}

function discoverOccurrences(declaration: Declaration): readonly OccurrencePlan[] {
  const parsed = valueParser(declaration.value);
  const occurrences: OccurrencePlan[] = [];

  if (containsAmbiguousEscapedWord(parsed.nodes)) {
    throw new UnsupportedCssError(
      "Escaped identifiers split across value tokens are not supported",
    );
  }

  for (const node of parsed.nodes) {
    if (node.type !== "function") {
      continue;
    }

    const functionName = normalizeCssIdentifier(node.value);

    if (functionName === "url") {
      if (node.unclosed === true) {
        throw new UnsupportedCssError("Unclosed url() functions are not supported");
      }

      occurrences.push({
        declaration,
        end: node.sourceEndIndex,
        originalUrl: readUrl(node),
        start: node.sourceIndex,
        variants: new Map(),
      });
      continue;
    }

    if (functionName.startsWith("--")) {
      throw new UnsupportedCssError("Custom CSS functions in image values are not supported yet");
    }

    if (unsupportedDynamicFunctions.has(functionName)) {
      throw new UnsupportedCssError(`${functionName}() image values are not supported yet`);
    }

    if (containsUrl(node.nodes)) {
      throw new UnsupportedCssError("Nested url() functions are not supported yet");
    }
  }

  return occurrences;
}

function containsAmbiguousEscapedWord(nodes: readonly valueParser.Node[]): boolean {
  for (const node of nodes) {
    if (node.type === "word" && node.value.includes("\\")) {
      return true;
    }

    if (
      node.type === "function" &&
      normalizeCssIdentifier(node.value) !== "url" &&
      containsAmbiguousEscapedWord(node.nodes)
    ) {
      return true;
    }
  }

  return false;
}

function containsUrl(nodes: readonly valueParser.Node[]): boolean {
  for (const node of nodes) {
    if (node.type === "function") {
      if (normalizeCssIdentifier(node.value) === "url" || containsUrl(node.nodes)) {
        return true;
      }
    }
  }

  return false;
}

function readUrl(node: valueParser.FunctionNode): string {
  const meaningfulNodes = node.nodes.filter(
    (child) => child.type !== "space" && child.type !== "comment",
  );

  if (meaningfulNodes.length !== 1) {
    throw new UnsupportedCssError("url() must contain one quoted or unquoted URL");
  }

  const valueNode = meaningfulNodes[0];

  if (valueNode?.type !== "string" && valueNode?.type !== "word") {
    throw new UnsupportedCssError("url() must contain one quoted or unquoted URL");
  }

  if (valueNode.value.length === 0) {
    throw new UnsupportedCssError("Empty url() functions are not supported");
  }

  return decodeCssEscapes(valueNode.value);
}

async function resolveVariants(
  plans: ReadonlyMap<Declaration, DeclarationPlan>,
  result: Result,
  options: ReturnType<typeof normalizeOptions>,
): Promise<void> {
  interface ResolutionJob {
    readonly format: NormalizedFormatOptions;
    readonly occurrence: OccurrencePlan;
  }

  const jobs: ResolutionJob[] = [];

  for (const plan of plans.values()) {
    for (const occurrence of plan.occurrences) {
      for (const format of options.formats) {
        jobs.push({ format, occurrence });
      }
    }
  }

  const importer = result.opts.from;
  const settled = await Promise.allSettled(
    jobs.map(async ({ format, occurrence }): Promise<string | undefined> => {
      const request: ImgfmtVariantUrlRequest = {
        extension: format.extension,
        format: format.id,
        originalUrl: occurrence.originalUrl,
        property: occurrence.declaration.prop,
        ...(importer === undefined ? {} : { importer }),
      };
      return await options.resolveVariantUrl(request);
    }),
  );

  for (const [index, resolution] of settled.entries()) {
    const job = jobs[index];

    if (job === undefined) {
      throw new Error("Internal variant resolution index mismatch");
    }

    if (resolution.status === "rejected") {
      report(
        result,
        job.occurrence.declaration,
        "resolver-rejected",
        `Variant resolver failed for ${job.occurrence.originalUrl} (${job.format.id}): ${errorMessage(resolution.reason)}`,
        options.strict,
      );
      continue;
    }

    const url = resolution.value;

    if (url === undefined) {
      continue;
    }

    if (typeof url !== "string" || url.length === 0) {
      report(
        result,
        job.occurrence.declaration,
        "invalid-variant-url",
        `Variant resolver returned an empty or non-string URL for ${job.format.id}`,
        options.strict,
      );
      continue;
    }

    job.occurrence.variants.set(job.format.id, url);
  }
}

function createMirror(
  rule: Rule,
  state: MirrorState,
  plans: ReadonlyMap<Declaration, DeclarationPlan>,
  formats: readonly NormalizedFormatOptions[],
): Rule {
  const mirror = rule.clone({ selector: gateSelector(rule.selector, state.state.tokens) });
  mirror.removeAll();

  for (const node of rule.nodes) {
    if (node.type !== "decl") {
      continue;
    }

    const property = normalizeCssIdentifier(node.prop);

    if (!controlledProperties.has(property)) {
      continue;
    }

    if (property === "all") {
      for (const longhand of backgroundLonghands) {
        mirror.append(node.clone({ prop: longhand }));
      }
      continue;
    }

    const plan = plans.get(node);
    const value = plan === undefined ? node.value : renderValue(plan, state, formats);
    mirror.append(node.clone({ value }));
  }

  return mirror;
}

function renderValue(
  plan: DeclarationPlan,
  state: MirrorState,
  formats: readonly NormalizedFormatOptions[],
): string {
  let value = plan.declaration.value;

  for (const occurrence of [...plan.occurrences].reverse()) {
    const replacement =
      state.kind === "pending"
        ? "none"
        : serializeSelectedUrl(occurrence, state.state.capabilities, formats);
    value = `${value.slice(0, occurrence.start)}${replacement}${value.slice(occurrence.end)}`;
  }

  return value;
}

function serializeSelectedUrl(
  occurrence: OccurrencePlan,
  capabilities: CapabilityVector,
  formats: readonly NormalizedFormatOptions[],
): string {
  const variants: ImageVariantUrl[] = [];

  for (const format of formats) {
    const url = occurrence.variants.get(format.id);

    if (url !== undefined) {
      variants.push({ format: format.id, url });
    }
  }

  const selected = selectCandidate({
    capabilities,
    originalUrl: occurrence.originalUrl,
    preference: formats.map((format) => format.id),
    variants,
  });

  if (selected.kind === "original") {
    return occurrence.declaration.value.slice(occurrence.start, occurrence.end);
  }

  return `url("${escapeCssString(selected.url)}")`;
}

function escapeCssString(value: string): string {
  let output = "";

  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (character === "\\" || character === '"') {
      output += `\\${character}`;
    } else if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f)) {
      output += `\\${codePoint.toString(16)} `;
    } else {
      output += character;
    }
  }

  return output;
}

function decodeCssEscapes(value: string): string {
  let output = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== "\\") {
      output += character;
      continue;
    }

    const next = value[index + 1];

    if (next === undefined) {
      throw new UnsupportedCssError("A URL cannot end with an incomplete CSS escape");
    }

    if (next === "\n" || next === "\f") {
      index += 1;
      continue;
    }

    if (next === "\r") {
      index += value[index + 2] === "\n" ? 2 : 1;
      continue;
    }

    if (/^[0-9a-f]$/i.test(next)) {
      let hex = "";
      let cursor = index + 1;

      while (cursor < value.length && hex.length < 6 && /^[0-9a-f]$/i.test(value[cursor] ?? "")) {
        hex += value[cursor];
        cursor += 1;
      }

      if (/\s/.test(value[cursor] ?? "")) {
        cursor += value[cursor] === "\r" && value[cursor + 1] === "\n" ? 2 : 1;
      }

      const codePoint = Number.parseInt(hex, 16);
      output +=
        codePoint === 0 || codePoint > 0x10_ff_ff || (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
          ? "�"
          : String.fromCodePoint(codePoint);
      index = cursor - 1;
      continue;
    }

    output += next;
    index += 1;
  }

  return output;
}

function enumerateReadyStates(formats: readonly NormalizedFormatOptions[]): readonly ReadyState[] {
  const states: ReadyState[] = [];
  const stateCount = 2 ** formats.length;

  for (let mask = 0; mask < stateCount; mask += 1) {
    const capabilities: Record<string, boolean> = {};
    const tokens: string[] = ["ready"];

    for (const [index, format] of formats.entries()) {
      const supported = (mask & (1 << (formats.length - index - 1))) !== 0;
      capabilities[format.id] = supported;
      tokens.push(supported ? format.id : `no-${format.id}`);
    }

    states.push({ capabilities, tokens });
  }

  return states;
}

function pendingTokens(formatCount: number): readonly string[] {
  return ["pending", ...Array.from({ length: formatCount }, () => "")];
}

function gateSelector(selector: string, tokens: readonly string[]): string {
  return selectorParser((root) => {
    root.each((branch) => {
      gateSelectorBranch(branch, tokens);
    });
  }).processSync(selector, { lossless: true });
}

function gateSelectorBranch(branch: selectorParser.Selector, tokens: readonly string[]): void {
  let hasNesting = false;
  branch.walkNesting(() => {
    hasNesting = true;
  });

  if (hasNesting) {
    throw new UnsupportedCssError("Selectors containing & are not supported");
  }

  const firstMeaningful = branch.nodes.find((node) => node.type !== "comment");

  if (firstMeaningful === undefined || firstMeaningful.type === "combinator") {
    throw new UnsupportedCssError("Relative or empty selectors are not supported");
  }

  const rootPseudos: selectorParser.Pseudo[] = [];
  const htmlTags: selectorParser.Tag[] = [];
  branch.walkPseudos((pseudo) => {
    if (normalizeCssIdentifier(pseudo.value) === ":root") {
      rootPseudos.push(pseudo);
    }
  });
  branch.walkTags((tag) => {
    if (normalizeCssIdentifier(tag.value) === "html") {
      htmlTags.push(tag);
    }
  });

  const beginsAtRoot =
    (firstMeaningful.type === "pseudo" &&
      normalizeCssIdentifier(firstMeaningful.value) === ":root") ||
    (firstMeaningful.type === "tag" &&
      normalizeCssIdentifier(firstMeaningful.value) === "html" &&
      !firstMeaningful.namespace);

  if (beginsAtRoot) {
    const directRootPseudo = firstMeaningful.type === "pseudo" ? firstMeaningful : undefined;
    const directHtmlTag = firstMeaningful.type === "tag" ? firstMeaningful : undefined;

    if (
      rootPseudos.some((pseudo) => pseudo !== directRootPseudo) ||
      htmlTags.some((tag) => tag !== directHtmlTag)
    ) {
      throw new UnsupportedCssError("Indirect or repeated root selectors are not supported");
    }

    const additions = [createRootPseudo(), ...createCapabilitySelectors(tokens)];
    let insertionPoint: selectorParser.Node = firstMeaningful;

    for (const addition of additions) {
      branch.insertAfter(insertionPoint, addition);
      insertionPoint = addition;
    }
    return;
  }

  if (rootPseudos.length > 0 || htmlTags.length > 0) {
    throw new UnsupportedCssError("Indirect root selectors are not supported");
  }

  const originalNodes = branch.nodes.map((node) => node.clone());
  branch.removeAll();
  branch.append(createRootPseudo());

  for (const capabilitySelector of createCapabilitySelectors(tokens)) {
    branch.append(capabilitySelector);
  }

  branch.append(selectorParser.combinator({ value: " " }));

  for (const node of originalNodes) {
    branch.append(node);
  }
}

function createRootPseudo(): selectorParser.Pseudo {
  return selectorParser.pseudo({ value: ":root" });
}

function createCapabilitySelectors(tokens: readonly string[]): selectorParser.Attribute[] {
  return tokens.map((token) =>
    selectorParser.attribute({
      attribute: capabilityAttribute,
      ...(token.length === 0 ? {} : { operator: "~=", quoteMark: '"', value: token }),
      raws: {},
      value: token.length === 0 ? undefined : token,
    }),
  );
}

function isCssWideKeyword(value: string): boolean {
  return /^(?:inherit|initial|revert|revert-layer|unset)$/i.test(value.trim());
}

function normalizeAtRuleName(atRule: AtRule): string {
  const escapedContinuation =
    atRule.raws.afterName === "" && atRule.params.startsWith("\\")
      ? readCssIdentifierPrefix(atRule.params)
      : "";
  return normalizeCssIdentifier(`${atRule.name}${escapedContinuation}`);
}

function readCssIdentifierPrefix(value: string): string {
  let index = 0;

  while (index < value.length) {
    const character = value[index];

    if (character === "\\") {
      const next = value[index + 1];

      if (next === undefined || next === "\n" || next === "\r" || next === "\f") {
        break;
      }

      index += 2;

      if (/^[0-9a-f]$/i.test(next)) {
        let hexLength = 1;

        while (index < value.length && hexLength < 6 && /^[0-9a-f]$/i.test(value[index] ?? "")) {
          index += 1;
          hexLength += 1;
        }

        if (/\s/.test(value[index] ?? "")) {
          index += value[index] === "\r" && value[index + 1] === "\n" ? 2 : 1;
        }
      }

      continue;
    }

    if (/^[\w-]$/u.test(character ?? "") || (character?.codePointAt(0) ?? 0) >= 0x80) {
      index += 1;
      continue;
    }

    break;
  }

  return value.slice(0, index);
}

function normalizeCssIdentifier(value: string): string {
  return decodeCssEscapes(value).toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
