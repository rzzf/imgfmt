import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import process from "node:process";

import type { BuildOptions, Metafile, OnEndResult, PartialMessage, PluginBuild } from "esbuild";

import { generateRuntimeSource } from ".";
import { normalizeOptions } from "../core/options";
import { processCssModule } from "../css/transform";
import type { ImgfmtDocumentManifest, ImgfmtOptions } from "../types";
import {
  injectDocumentBootstrap,
  resolveDocumentFiles,
  type ResolvedDocumentFile,
} from "./document";

const pluginName = "imgfmt";

type CssLoader = "css" | "local-css";

/** Installs imgfmt's native esbuild lifecycle into an unplugin esbuild adapter. */
export function setupEsbuild(build: PluginBuild, inputOptions: ImgfmtOptions = {}): void {
  const initialOptions = build.initialOptions;
  const document = inputOptions.document;

  if (document === undefined) {
    throw new TypeError(
      'imgfmt/esbuild requires document mode "static" or "manual" to install the exact-one bootstrap',
    );
  }

  validateBuildOptions(initialOptions, document.mode);

  const root = resolve(initialOptions.absWorkingDir ?? process.cwd());
  const outputDirectory = resolve(root, requiredOutputDirectory(initialOptions));
  const documents = document.mode === "static" ? resolveDocumentFiles(document.files, root) : [];
  const watchedDocuments =
    document.mode === "static"
      ? documents.map((file) => file.input)
      : (document.watchFiles ?? []).map((file) => (isAbsolute(file) ? file : resolve(root, file)));

  const documentInputs = new Set(documents.map((file) => normalizeFileIdentity(file.input)));

  for (const file of documents) {
    const outputPath = resolve(outputDirectory, file.output);

    if (documentInputs.has(normalizeFileIdentity(outputPath))) {
      throw new TypeError(`imgfmt refuses to overwrite an HTML source: ${outputPath}`);
    }
  }

  const options = normalizeOptions(inputOptions);
  const runtimeSource = generateRuntimeSource({
    deadlineMs: options.probeDeadlineMs,
    formats: options.formats,
  });
  const manifest = createManifest(runtimeSource);
  const transformedCss = new Set<string>();

  initialOptions.metafile = true;

  build.onStart(() => {
    transformedCss.clear();
  });

  if (watchedDocuments.length !== 0) {
    build.onResolve({ filter: /.*/ }, (args) =>
      args.kind === "entry-point" ? { watchFiles: [...new Set(watchedDocuments)] } : undefined,
    );
  }

  if (inputOptions.postcss !== "manual") {
    validateConfiguredCssLoaders(initialOptions.loader);

    build.onLoad({ filter: /\.css$/, namespace: "file" }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const contents = await processCssModule(source, args.path, inputOptions, {
        allowImports: true,
      });

      transformedCss.add(normalizeFileIdentity(args.path));
      return {
        contents,
        loader: selectCssLoader(args.path, initialOptions.loader),
        resolveDir: dirname(args.path),
        watchFiles: [args.path],
      };
    });
  }

  build.onEnd(async (result): Promise<OnEndResult | undefined> => {
    if (result.errors.length !== 0) {
      return;
    }

    try {
      const metafile = result.metafile;

      if (metafile === undefined) {
        throw new Error("imgfmt/esbuild requires build metadata to validate its outputs");
      }

      if (inputOptions.postcss !== "manual") {
        assertEveryCssInputWasTransformed(metafile, root, transformedCss);
      }

      assertDocumentOutputsAreAvailable(metafile, root, outputDirectory, documents);

      if (document.mode === "manual") {
        await document.onManifest(manifest);
        return;
      }

      await writeStaticDocuments(documents, outputDirectory, manifest);
    } catch (error) {
      return {
        errors: [toBuildMessage(error)],
      };
    }
  });
}

function assertDocumentOutputsAreAvailable(
  metafile: Metafile,
  root: string,
  outputDirectory: string,
  documents: readonly ResolvedDocumentFile[],
): void {
  if (documents.length === 0) {
    return;
  }

  const buildOutputs = new Set(
    Object.keys(metafile.outputs).map((path) =>
      normalizeFileIdentity(isAbsolute(path) ? path : resolve(root, path)),
    ),
  );

  for (const document of documents) {
    const outputPath = resolve(outputDirectory, document.output);

    if (buildOutputs.has(normalizeFileIdentity(outputPath))) {
      throw new Error(`imgfmt document output collides with an esbuild output: ${document.output}`);
    }
  }
}

function validateBuildOptions(options: BuildOptions, documentMode: "manual" | "static"): void {
  if (options.bundle !== true) {
    throw new TypeError("imgfmt/esbuild requires bundle: true");
  }

  if (options.platform !== undefined && options.platform !== "browser") {
    throw new TypeError("imgfmt/esbuild supports browser builds only");
  }

  if (options.outfile !== undefined) {
    throw new TypeError("imgfmt/esbuild requires outdir instead of outfile");
  }

  if (options.outdir === undefined || options.outdir.length === 0) {
    throw new TypeError("imgfmt/esbuild requires an output directory");
  }

  if (options.stdin !== undefined) {
    throw new TypeError("imgfmt/esbuild does not support stdin entry points");
  }

  if (entryPointCount(options.entryPoints) === 0) {
    throw new TypeError("imgfmt/esbuild requires at least one application entry point");
  }

  if (documentMode === "static" && options.write === false) {
    throw new TypeError(
      'imgfmt/esbuild document mode "static" is incompatible with write: false; use "manual"',
    );
  }
}

function requiredOutputDirectory(options: BuildOptions): string {
  if (options.outdir === undefined || options.outdir.length === 0) {
    throw new TypeError("imgfmt/esbuild requires an output directory");
  }

  return options.outdir;
}

function entryPointCount(entryPoints: BuildOptions["entryPoints"]): number {
  if (entryPoints === undefined) {
    return 0;
  }

  return Array.isArray(entryPoints) ? entryPoints.length : Object.keys(entryPoints).length;
}

function validateConfiguredCssLoaders(loaders: BuildOptions["loader"]): void {
  for (const [extension, loader] of Object.entries(loaders ?? {})) {
    if (extension.toLowerCase().endsWith(".css") && loader !== "css" && loader !== "local-css") {
      throw new TypeError(
        `imgfmt/esbuild cannot transform CSS configured with the ${loader} loader: ${extension}`,
      );
    }
  }
}

function selectCssLoader(path: string, loaders: BuildOptions["loader"]): CssLoader {
  const matchingExtension = Object.keys(loaders ?? {})
    .filter((extension) => path.endsWith(extension))
    .sort((left, right) => right.length - left.length)[0];
  const configured = matchingExtension === undefined ? undefined : loaders?.[matchingExtension];

  if (configured === "css" || configured === "local-css") {
    return configured;
  }

  return path.endsWith(".module.css") ? "local-css" : "css";
}

function assertEveryCssInputWasTransformed(
  metafile: Metafile,
  root: string,
  transformedCss: ReadonlySet<string>,
): void {
  const missedInputs = new Set<string>();

  for (const output of Object.values(metafile.outputs)) {
    for (const inputPath of Object.keys(output.inputs)) {
      if (!inputPath.toLowerCase().endsWith(".css")) {
        continue;
      }

      const absoluteInput = normalizeFileIdentity(resolve(root, inputPath));

      if (!transformedCss.has(absoluteInput)) {
        missedInputs.add(inputPath);
      }
    }
  }

  if (missedInputs.size !== 0) {
    throw new Error(
      `imgfmt/esbuild did not transform every CSS input: ${[...missedInputs].sort().join(", ")}; ` +
        'install imgfmt/postcss in the owning CSS pipeline and set postcss: "manual"',
    );
  }
}

function createManifest(runtimeSource: string): ImgfmtDocumentManifest {
  return Object.freeze({
    install(html: string): string {
      return injectDocumentBootstrap(html, runtimeSource);
    },
  });
}

async function writeStaticDocuments(
  documents: readonly ResolvedDocumentFile[],
  outputDirectory: string,
  manifest: ImgfmtDocumentManifest,
): Promise<void> {
  const outputs = await Promise.all(
    documents.map(async (document) => ({
      contents: manifest.install(await readFile(document.input, "utf8")),
      path: resolve(outputDirectory, document.output),
    })),
  );

  await Promise.all(
    outputs.map(async (output) => {
      await mkdir(dirname(output.path), { recursive: true });
      const temporaryPath = resolve(
        dirname(output.path),
        `.${basename(output.path)}.imgfmt-${process.pid}-${randomUUID()}.tmp`,
      );

      try {
        await writeFile(temporaryPath, output.contents, "utf8");
        await rename(temporaryPath, output.path);
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
    }),
  );
}

function toBuildMessage(error: unknown): PartialMessage {
  return {
    detail: error,
    pluginName,
    text: error instanceof Error ? error.message : String(error),
  };
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function normalizeFileIdentity(path: string): string {
  return normalizePath(realPathOrResolved(path));
}

function realPathOrResolved(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}
