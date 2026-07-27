import type { Plugin } from "postcss";

import { normalizeOptions } from "./core/options";
import { transformCssRoot } from "./css";
import { capabilityAttribute, generateRuntimeSource, pendingCapabilityState } from "./runtime";
import { runtimeMarkerAttribute } from "./runtime/document";
import type { ImgfmtParcelOptions } from "./types";

export type { ImgfmtParcelOptions } from "./types";

interface PosthtmlNode {
  attrs?: Record<string, boolean | string>;
  content?: Array<PosthtmlNode | string>;
  tag?: string;
}

type PosthtmlTree = Array<PosthtmlNode | string>;
export type ImgfmtPosthtmlPlugin = (tree: PosthtmlTree) => PosthtmlTree;

interface ImgfmtParcelPlugin extends ImgfmtPosthtmlPlugin {
  postcss: Plugin;
}

interface ImgfmtParcelPluginCreator {
  (inputOptions?: ImgfmtParcelOptions): ImgfmtParcelPlugin;
  postcss: Plugin;
}

const parcelPlugin = ((inputOptions: ImgfmtParcelOptions = {}): ImgfmtParcelPlugin => {
  const options = readParcelOptions(inputOptions);
  const plugin = posthtml(options) as ImgfmtParcelPlugin;
  plugin.postcss = createParcelPostcssPlugin(options);
  return plugin;
}) as ImgfmtParcelPluginCreator;

parcelPlugin.postcss = createParcelPostcssPlugin();

export default parcelPlugin;

function createParcelPostcssPlugin(options: ImgfmtParcelOptions = {}): Plugin {
  return {
    postcssPlugin: "imgfmt/parcel",
    async OnceExit(root, { result }): Promise<void> {
      await transformCssRoot(root, result, options, { allowImports: true });
    },
  };
}

/**
 * Creates the matching PostHTML plugin used by Parcel's HTML transformer.
 *
 * Keep this next to the default PostCSS export so both sides share one option
 * contract without requiring a separately published Parcel plugin package.
 */
export function posthtml(inputOptions: ImgfmtParcelOptions = {}): ImgfmtPosthtmlPlugin {
  const options = normalizeOptions(readParcelOptions(inputOptions));
  const runtimeSource = generateRuntimeSource({
    deadlineMs: options.probeDeadlineMs,
    formats: options.formats,
  });

  return (tree): PosthtmlTree => {
    const nodes = readPosthtmlNodes(tree);
    const htmlNodes = nodes.filter((node) => node.tag?.toLowerCase() === "html");
    const headNodes = nodes.filter((node) => node.tag?.toLowerCase() === "head");
    const runtimeNodes = nodes.filter((node) => hasAttribute(node, runtimeMarkerAttribute));

    if (htmlNodes.length !== 1) {
      throw new Error("imgfmt/parcel requires exactly one <html> element");
    }

    if (headNodes.length !== 1) {
      throw new Error("imgfmt/parcel requires exactly one <head> element");
    }

    if (runtimeNodes.length !== 0) {
      throw new Error(`imgfmt owns the ${runtimeMarkerAttribute} attribute`);
    }

    const html = htmlNodes[0]!;
    const head = headNodes[0]!;
    const capability = readAttribute(html, capabilityAttribute);

    if (capability !== undefined && capability !== pendingCapabilityState) {
      throw new Error(`imgfmt owns the ${capabilityAttribute} attribute on <html>`);
    }

    html.attrs = {
      ...html.attrs,
      [capabilityAttribute]: pendingCapabilityState,
    };
    head.content = [
      {
        attrs: { [runtimeMarkerAttribute]: "" },
        content: [runtimeSource],
        tag: "script",
      },
      ...(head.content ?? []),
    ];

    return tree;
  };
}

function readParcelOptions(value: ImgfmtParcelOptions): ImgfmtParcelOptions {
  const options = value as Record<string, unknown>;

  if (options.document !== undefined) {
    throw new TypeError("imgfmt/parcel owns emitted HTML; remove the document option");
  }

  if (options.postcss !== undefined) {
    throw new TypeError(
      "imgfmt/parcel owns its PostCSS pipeline position; remove the postcss option",
    );
  }

  return value;
}

function readPosthtmlNodes(tree: PosthtmlTree): PosthtmlNode[] {
  const nodes: PosthtmlNode[] = [];

  for (const value of tree) {
    if (typeof value === "string") {
      continue;
    }

    nodes.push(value);

    if (value.content !== undefined) {
      nodes.push(...readPosthtmlNodes(value.content));
    }
  }

  return nodes;
}

function hasAttribute(node: PosthtmlNode, expectedName: string): boolean {
  return (
    node.attrs !== undefined &&
    Object.keys(node.attrs).some((name) => name.toLowerCase() === expectedName)
  );
}

function readAttribute(node: PosthtmlNode, expectedName: string): boolean | string | undefined {
  const entry = Object.entries(node.attrs ?? {}).find(
    ([name]) => name.toLowerCase() === expectedName,
  );
  return entry?.[1];
}
