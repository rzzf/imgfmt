import type { Declaration, Node, Plugin, PluginCreator, Result, Root, Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";

import { selectCandidate, type CapabilityVector, type ImageVariantUrl } from "../core";
import {
  isSupportedSourceImageUrl,
  normalizeOptions,
  type NormalizedFormatOptions,
} from "../core/options";
import { capabilityAttribute } from "../runtime";
import type { ImgfmtOptions, ImgfmtVariantUrlRequest } from "../types";
import type {
  CssCompilerOptions,
  DeclarationPlan,
  EmittedReadyState,
  ImageValueProperty,
  OccurrencePlan,
  ReadyState,
  ResolutionJob,
} from "./types";

export type { CssCompilerOptions } from "./types";

const pluginName = "imgfmt";

const imageValueProperties: ReadonlyMap<string, ImageValueProperty> = new Map([
  [
    "-webkit-mask",
    {
      generatedProperty: "-webkit-mask-image",
      layerName: "mask",
      sourceBehavior: "suppress-urls",
    },
  ],
  ["-webkit-mask-image", { sourceBehavior: "suppress-urls" }],
  [
    "background",
    {
      generatedProperty: "background-image",
      layerName: "background",
      sourceBehavior: "suppress-urls",
    },
  ],
  ["background-image", { sourceBehavior: "suppress-urls" }],
  ["cursor", { sourceBehavior: "remove-declaration" }],
  [
    "mask",
    {
      generatedProperty: "mask-image",
      layerName: "mask",
      sourceBehavior: "suppress-urls",
    },
  ],
  ["mask-image", { sourceBehavior: "suppress-urls" }],
]);
const allowedContainerAtRules: ReadonlySet<string> = new Set([
  "container",
  "layer",
  "media",
  "supports",
]);
const imageFunctions: ReadonlySet<string> = new Set([
  "-moz-element",
  "-webkit-cross-fade",
  "-webkit-image-set",
  "cross-fade",
  "element",
  "image",
  "image-set",
  "paint",
]);

class UnsupportedCssError extends Error {}

export function createPostcssPlugin(
  inputOptions: ImgfmtOptions = {},
  compilerOptions: CssCompilerOptions = {},
): Plugin {
  const options = normalizeOptions(inputOptions);

  return {
    postcssPlugin: pluginName,
    async Once(root, { result }): Promise<void> {
      await transformCss(root, result, options, compilerOptions);
    },
  };
}

export const postcssPlugin: PluginCreator<ImgfmtOptions> = (inputOptions = {}) =>
  createPostcssPlugin(inputOptions);

postcssPlugin.postcss = true;

async function transformCss(
  root: Root,
  result: Result,
  options: ReturnType<typeof normalizeOptions>,
  compilerOptions: CssCompilerOptions,
): Promise<void> {
  if (compilerOptions.allowImports !== true) {
    reportRemainingImports(root, result);
  }

  const declarationPlans = new Map<Declaration, DeclarationPlan>();
  const eligibleRules: Rule[] = [];

  root.walkRules((rule) => {
    const declarations = directImageDeclarations(rule);

    if (declarations.length === 0) {
      return;
    }

    const contextProblem = findUnsupportedContext(rule);

    if (contextProblem !== undefined) {
      report(result, rule, "unsupported-context", contextProblem, true);
      return;
    }

    try {
      gateSelector(rule.selector, ["ready"]);
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
    let hasManagedUrl = false;

    for (const declaration of declarations) {
      try {
        const property = imageValueProperties.get(normalizeIdentifier(declaration.prop));

        if (property?.layerName !== undefined) {
          extractLayerImages(declaration.value, property.layerName);
        }

        const occurrences = discoverOccurrences(declaration);

        if (occurrences.length > 0) {
          declarationPlans.set(declaration, { declaration, occurrences });
          hasManagedUrl = true;
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

    if (ruleIsSupported && hasManagedUrl) {
      eligibleRules.push(rule);
    } else {
      for (const declaration of declarations) {
        declarationPlans.delete(declaration);
      }
    }
  });

  await resolveVariants(declarationPlans, result, options);

  const states = enumerateReadyStates(options.formats);

  for (const rule of eligibleRules) {
    const emittedStates: EmittedReadyState[] = [];

    for (const state of states) {
      const mirror = createMirror(rule, state, declarationPlans, options.formats);
      const declarationSignature = signatureForDeclarations(mirror);
      const winningState = findWinningState(emittedStates, state.mask);

      if (winningState?.declarationSignature === declarationSignature) {
        continue;
      }

      rule.before(mirror);
      emittedStates.push({
        declarationSignature,
        mask: state.mask,
        supportedCount: state.tokens.length - 1,
      });
    }

    handleManagedSourceDeclarations(rule, declarationPlans);
  }
}

function directImageDeclarations(rule: Rule): Declaration[] {
  const declarations: Declaration[] = [];

  for (const node of rule.nodes) {
    if (node.type === "decl" && imageValueProperties.has(normalizeIdentifier(node.prop))) {
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
      const name = normalizeIdentifier(parent.name);

      if (name.endsWith("keyframes")) {
        return "Managed images inside keyframes are not supported";
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
    if (normalizeIdentifier(atRule.name) !== "import") {
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

  for (const node of parsed.nodes) {
    if (node.type !== "function") {
      continue;
    }

    const functionName = normalizeIdentifier(node.value);

    if (functionName === "url") {
      if (node.unclosed === true) {
        throw new UnsupportedCssError("Unclosed url() functions are not supported");
      }

      const source = readUrl(node, declaration.value);

      if (isSupportedSourceImageUrl(source.value)) {
        occurrences.push({
          declaration,
          functionEnd: node.sourceEndIndex,
          functionStart: node.sourceIndex,
          originalUrl: source.value,
          urlEnd: source.end,
          urlStart: source.start,
          variants: new Map(),
        });
      }
      continue;
    }
  }

  return occurrences;
}

function readUrl(
  node: valueParser.FunctionNode,
  declarationValue: string,
): { readonly end: number; readonly start: number; readonly value: string } {
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

  const quoted = valueNode.type === "string";
  const start = valueNode.sourceIndex + (quoted ? 1 : 0);
  const end = valueNode.sourceEndIndex - (quoted ? 1 : 0);

  return {
    end,
    start,
    value: declarationValue.slice(start, end),
  };
}

async function resolveVariants(
  plans: ReadonlyMap<Declaration, DeclarationPlan>,
  result: Result,
  options: ReturnType<typeof normalizeOptions>,
): Promise<void> {
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
  state: ReadyState,
  plans: ReadonlyMap<Declaration, DeclarationPlan>,
  formats: readonly NormalizedFormatOptions[],
): Rule {
  const mirror = rule.clone({ selector: gateSelector(rule.selector, state.tokens) });
  mirror.removeAll();

  for (const node of rule.nodes) {
    if (node.type !== "decl") {
      continue;
    }

    const plan = plans.get(node);

    if (plan === undefined) {
      continue;
    }

    const property = imageValueProperties.get(normalizeIdentifier(node.prop));

    if (property === undefined) {
      throw new Error(`Internal image property mismatch: ${node.prop}`);
    }

    const sourceValue = renderValue(plan, state, formats);
    const value =
      property.layerName === undefined
        ? sourceValue
        : extractLayerImages(sourceValue, property.layerName);
    mirror.append(node.clone({ prop: property.generatedProperty ?? node.prop, value }));
  }

  return mirror;
}

function renderValue(
  plan: DeclarationPlan,
  state: ReadyState,
  formats: readonly NormalizedFormatOptions[],
): string {
  let value = plan.declaration.value;

  for (const occurrence of [...plan.occurrences].reverse()) {
    const selectedUrl = selectUrl(occurrence, state.capabilities, formats);

    if (selectedUrl !== occurrence.originalUrl) {
      value = `${value.slice(0, occurrence.urlStart)}${selectedUrl}${value.slice(occurrence.urlEnd)}`;
    }
  }

  return value;
}

function handleManagedSourceDeclarations(
  rule: Rule,
  plans: ReadonlyMap<Declaration, DeclarationPlan>,
): void {
  for (const node of rule.nodes.slice()) {
    if (node.type !== "decl") {
      continue;
    }

    const plan = plans.get(node);

    if (plan === undefined) {
      continue;
    }

    const property = imageValueProperties.get(normalizeIdentifier(node.prop));

    if (property === undefined) {
      throw new Error(`Internal image property mismatch: ${node.prop}`);
    }

    if (property.sourceBehavior === "remove-declaration") {
      node.remove();
      continue;
    }

    let value = node.value;

    for (const occurrence of [...plan.occurrences].reverse()) {
      value = `${value.slice(0, occurrence.functionStart)}none${value.slice(occurrence.functionEnd)}`;
    }

    node.value = value;
  }

  if (rule.nodes.length === 0) {
    rule.remove();
  }
}

function extractLayerImages(value: string, layerName: string): string {
  if (isCssWideKeyword(value)) {
    return value;
  }

  const parsed = valueParser(value);
  const layers: valueParser.Node[][] = [[]];
  const separators: string[] = [];

  for (const node of parsed.nodes) {
    if (node.type === "div" && node.value === ",") {
      separators.push(value.slice(node.sourceIndex, node.sourceEndIndex));
      layers.push([]);
      continue;
    }

    layers.at(-1)?.push(node);
  }

  return layers
    .map((nodes): string => {
      const candidates: string[] = [];

      for (const node of nodes) {
        if (node.type === "function") {
          const name = normalizeIdentifier(node.value);

          if (name === "url" || imageFunctions.has(name) || isGradientFunction(name)) {
            candidates.push(value.slice(node.sourceIndex, node.sourceEndIndex));
          }
          continue;
        }

        if (node.type === "word" && normalizeIdentifier(node.value) === "none") {
          candidates.push(value.slice(node.sourceIndex, node.sourceEndIndex));
        }
      }

      if (candidates.length > 1) {
        throw new UnsupportedCssError(`A ${layerName} layer must contain at most one image value`);
      }

      return candidates[0] ?? "none";
    })
    .reduce(
      (output, image, index) =>
        index === 0 ? image : `${output}${separators[index - 1] ?? ", "}${image}`,
      "",
    );
}

function isGradientFunction(name: string): boolean {
  return (
    name === "-webkit-gradient" ||
    /^(?:-(?:moz|ms|o|webkit)-)?(?:repeating-)?(?:conic|linear|radial)-gradient$/.test(name)
  );
}

function selectUrl(
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

  return selected.url;
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

      if (supported) {
        tokens.push(format.id);
      }
    }

    states.push({ capabilities, mask, tokens });
  }

  return states;
}

function findWinningState(
  emittedStates: readonly EmittedReadyState[],
  targetMask: number,
): EmittedReadyState | undefined {
  let winner: EmittedReadyState | undefined;

  for (const state of emittedStates) {
    // A positive-token gate matches every capability superset. More tokens win by specificity,
    // while a later emitted gate wins a tie.
    if ((state.mask & targetMask) !== state.mask) {
      continue;
    }

    if (winner === undefined || state.supportedCount >= winner.supportedCount) {
      winner = state;
    }
  }

  return winner;
}

function signatureForDeclarations(rule: Rule): string {
  return JSON.stringify(rule.nodes.map((node) => node.toString()));
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
    if (normalizeIdentifier(pseudo.value) === ":root") {
      rootPseudos.push(pseudo);
    }
  });
  branch.walkTags((tag) => {
    if (normalizeIdentifier(tag.value) === "html") {
      htmlTags.push(tag);
    }
  });

  const beginsAtRoot =
    (firstMeaningful.type === "pseudo" && normalizeIdentifier(firstMeaningful.value) === ":root") ||
    (firstMeaningful.type === "tag" &&
      normalizeIdentifier(firstMeaningful.value) === "html" &&
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

function normalizeIdentifier(value: string): string {
  return value.toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
