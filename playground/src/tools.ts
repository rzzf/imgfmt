import { getFormatPreset, type FormatPresetId } from "./formats";

export type BuildToolId =
  | "esbuild"
  | "postcss"
  | "rolldown"
  | "rollup"
  | "rspack"
  | "vite"
  | "webpack";

export interface ToolDefinition {
  readonly description: string;
  readonly fileName: string;
  readonly id: BuildToolId;
  readonly label: string;
  readonly mode: "Automatic CSS" | "CSS compiler" | "Manual CSS";
  readonly note: string;
  readonly pipeline: readonly string[];
  snippet(formatPreset: FormatPresetId): string;
  readonly title: string;
}

export const tools: readonly ToolDefinition[] = [
  {
    description:
      "Vite can append imgfmt to its PostCSS pipeline, then owns the pending HTML state and capability runtime in both dev and build.",
    fileName: "vite.config.ts",
    id: "vite",
    label: "Vite",
    mode: "Automatic CSS",
    note: 'Use postcss: "manual" when Vite discovers an external PostCSS configuration.',
    pipeline: ["Source CSS", "imgfmt/postcss", "Vite asset graph", "HTML + runtime"],
    snippet: (formatPreset) => `import { defineConfig } from "vite";
import imgfmt from "imgfmt/vite";

export default defineConfig({
  plugins: [
    imgfmt({
      formats: ${formatListSource(formatPreset)},
    }),
  ],
});`,
    title: "Vite owns the complete browser-app lifecycle.",
  },
  {
    description:
      "Rollup runs the shared transform on source CSS. A downstream CSS plugin still extracts assets, while an HTML plugin emits the document.",
    fileName: "rollup.config.ts",
    id: "rollup",
    label: "Rollup",
    mode: "Automatic CSS",
    note: "Keep imgfmt before the CSS extractor and emit at least one HTML asset.",
    pipeline: ["Source CSS", "imgfmt", "CSS extractor", "Emitted HTML"],
    snippet: (formatPreset) => `import html from "@rollup/plugin-html";
import imgfmt from "imgfmt/rollup";
import css from "rollup-plugin-postcss";

export default {
  input: "src/main.ts",
  output: { dir: "dist", format: "es" },
  plugins: [
    imgfmt({
      formats: ${formatListSource(formatPreset)},
    }),
    css({ extract: true }),
    html(),
  ],
};`,
    title: "Rollup transforms before downstream extraction.",
  },
  {
    description:
      "Rolldown follows the Rollup contract: imgfmt transforms source CSS, another plugin extracts it, and emitted HTML receives the runtime.",
    fileName: "rolldown.config.ts",
    id: "rolldown",
    label: "Rolldown",
    mode: "Automatic CSS",
    note: "Automatic and manual PostCSS ownership match the Rollup adapter.",
    pipeline: ["Source CSS", "imgfmt", "CSS extractor", "Emitted HTML"],
    snippet: (formatPreset) => `import html from "@rollup/plugin-html";
import imgfmt from "imgfmt/rolldown";
import css from "rollup-plugin-postcss";

export default {
  input: "src/main.ts",
  output: { dir: "dist", format: "es" },
  plugins: [
    imgfmt({
      formats: ${formatListSource(formatPreset)},
    }),
    css({ extract: true }),
    html(),
  ],
};`,
    title: "Rolldown shares the Rollup integration boundary.",
  },
  {
    description:
      "webpack leaves CSS to postcss-loader. The imgfmt adapter connects HtmlWebpackPlugin to the inline capability runtime.",
    fileName: "webpack.config.ts",
    id: "webpack",
    label: "webpack",
    mode: "Manual CSS",
    note: 'The adapter requires postcss: "manual", a document target and HtmlWebpackPlugin.',
    pipeline: ["postcss-loader", "imgfmt/postcss", "webpack assets", "HtmlWebpackPlugin"],
    snippet: (formatPreset) => `import HtmlWebpackPlugin from "html-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import { defineConfig } from "imgfmt";
import imgfmtPostcss from "imgfmt/postcss";
import imgfmt from "imgfmt/webpack";

const options = defineConfig({
  formats: ${formatListSource(formatPreset)},
  postcss: "manual",
});

export default {
  entry: "./src/main.ts",
  target: "web",
  module: {
    rules: [
      {
        test: /\\.css$/i,
        use: [
          MiniCssExtractPlugin.loader,
          { loader: "css-loader", options: { importLoaders: 1 } },
          {
            loader: "postcss-loader",
            options: {
              postcssOptions: { plugins: [imgfmtPostcss(options)] },
            },
          },
        ],
      },
      {
        test: /\\.(?:avif|jpe?g|png|webp)$/i,
        type: "asset/resource",
      },
    ],
  },
  plugins: [new HtmlWebpackPlugin(), new MiniCssExtractPlugin(), imgfmt(options)],
};`,
    title: "webpack keeps the CSS compiler in its loader chain.",
  },
  {
    description:
      "Rspack also uses a caller-owned PostCSS loader. Its adapter installs the runtime through HtmlRspackPlugin without rewriting CSS itself.",
    fileName: "rspack.config.ts",
    id: "rspack",
    label: "Rspack",
    mode: "Manual CSS",
    note: 'The adapter requires postcss: "manual", a document target and HtmlRspackPlugin.',
    pipeline: ["postcss-loader", "imgfmt/postcss", "Rspack assets", "HtmlRspackPlugin"],
    snippet: (formatPreset) => `import { rspack } from "@rspack/core";
import { defineConfig } from "imgfmt";
import imgfmtPostcss from "imgfmt/postcss";
import imgfmt from "imgfmt/rspack";

const options = defineConfig({
  formats: ${formatListSource(formatPreset)},
  postcss: "manual",
});

export default {
  entry: "./src/main.ts",
  target: "web",
  module: {
    rules: [
      {
        test: /\\.css$/i,
        type: "css/auto",
        use: [
          {
            loader: "postcss-loader",
            options: {
              postcssOptions: { plugins: [imgfmtPostcss(options)] },
            },
          },
        ],
      },
      {
        test: /\\.(?:avif|jpe?g|png|webp)$/i,
        type: "asset/resource",
      },
    ],
  },
  plugins: [new rspack.HtmlRspackPlugin(), imgfmt(options)],
};`,
    title: "Rspack separates CSS ownership from HTML delivery.",
  },
  {
    description:
      "esbuild can transform filesystem CSS automatically, but document ownership is explicit because esbuild has no native HTML lifecycle.",
    fileName: "build.ts",
    id: "esbuild",
    label: "esbuild",
    mode: "Automatic CSS",
    note: 'Choose document mode "static" or "manual"; both require bundle: true and outdir.',
    pipeline: ["Filesystem CSS", "imgfmt", "esbuild assets", "Static or manual HTML"],
    snippet: (formatPreset) => `import { build } from "esbuild";
import imgfmt from "imgfmt/esbuild";

await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints: ["src/main.ts"],
  outdir: "dist",
  loader: {
    ".avif": "file",
    ".jpg": "file",
    ".png": "file",
    ".webp": "file",
  },
  plugins: [
    imgfmt({
      formats: ${formatListSource(formatPreset)},
      document: {
        mode: "static",
        files: [{ input: "index.html", output: "index.html" }],
      },
    }),
  ],
});`,
    title: "esbuild makes document ownership explicit.",
  },
  {
    description:
      "The PostCSS entry is the canonical CSS compiler. It rewrites CSS only, so an application still needs a matching host adapter for HTML and runtime delivery.",
    fileName: "postcss.config.ts",
    id: "postcss",
    label: "PostCSS",
    mode: "CSS compiler",
    note: "Run it after import, nesting and preprocessor plugins; unresolved imports fail closed.",
    pipeline: ["Resolved CSS", "imgfmt/postcss", "Capability rules", "Host adapter"],
    snippet: (formatPreset) => `import imgfmt from "imgfmt/postcss";

export default {
  plugins: [
    imgfmt({
      formats: ${formatListSource(formatPreset)},
    }),
  ],
};`,
    title: "PostCSS is the shared compiler, not a seventh host.",
  },
];

const validToolIds: ReadonlySet<string> = new Set(tools.map((tool) => tool.id));

function formatListSource(formatPreset: FormatPresetId): string {
  return `[${getFormatPreset(formatPreset)
    .formatIds.map((id) => `{ id: "${id}" }`)
    .join(", ")}]`;
}

export function getToolDefinition(id: BuildToolId): ToolDefinition {
  const tool = tools.find((candidate) => candidate.id === id);

  if (tool === undefined) {
    throw new TypeError(`Unknown build tool: ${id}`);
  }

  return tool;
}

export function isBuildToolId(value: string): value is BuildToolId {
  return validToolIds.has(value);
}
