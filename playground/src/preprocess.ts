import type { StylesheetLanguageId } from "./stylesheets";

type CssPreprocessorLanguageId = Extract<StylesheetLanguageId, "less" | "scss">;

interface LessCompiler {
  options?: Readonly<Record<string, unknown>>;
  PluginLoader?: unknown;
  render(
    source: string,
    options: {
      readonly filename: string;
      readonly javascriptEnabled: boolean;
      readonly math: "parens-division";
    },
  ): Promise<{ readonly css: string }>;
}

interface LocationDetails {
  readonly column: number | undefined;
  readonly line: number | undefined;
}

let lessCompilerPromise: Promise<LessCompiler> | undefined;

export class StylesheetPreprocessError extends Error {
  readonly column: number | undefined;
  readonly language: Exclude<StylesheetLanguageId, "css">;
  readonly line: number | undefined;

  constructor(
    language: Exclude<StylesheetLanguageId, "css">,
    message: string,
    location: LocationDetails,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = "StylesheetPreprocessError";
    this.language = language;
    this.line = location.line;
    this.column = location.column;
  }
}

export async function preprocessStylesheet(
  source: string,
  language: StylesheetLanguageId,
): Promise<string> {
  if (language === "css") {
    return source;
  }

  try {
    switch (language) {
      case "less": {
        return await compileLess(source);
      }
      case "scss": {
        return await compileSass(source);
      }
      case "vue": {
        return await compileVueSfc(source);
      }
    }
  } catch (error) {
    throw normalizePreprocessError(language, error);
  }
}

async function compileVueSfc(source: string): Promise<string> {
  const { compileStyleAsync, parse } = await import("@vue/compiler-sfc");
  const parsed = parse(source, {
    filename: "input.vue",
    sourceMap: false,
  });
  const parseError = parsed.errors[0];

  if (parseError !== undefined) {
    throw createVueError(parseError);
  }

  if (parsed.descriptor.styles.length === 0) {
    throw new StylesheetPreprocessError(
      "vue",
      "Vue SFC input must contain at least one inline <style> block.",
      { column: undefined, line: undefined },
      undefined,
    );
  }

  const output: string[] = [];

  for (const block of parsed.descriptor.styles) {
    if (block.src !== undefined) {
      throw new StylesheetPreprocessError(
        "vue",
        "Vue SFC <style src> is not supported in the browser playground.",
        block.loc.start,
        undefined,
      );
    }

    if (block.module !== undefined) {
      throw new StylesheetPreprocessError(
        "vue",
        "Vue SFC <style module> is not supported because the playground only outputs CSS.",
        block.loc.start,
        undefined,
      );
    }

    const language = readVueStyleLanguage(block.lang, block.loc.start);
    let styleSource: string;

    try {
      styleSource = await preprocessStylesheet(block.content, language);
    } catch (error) {
      throw offsetVueStyleError(error, block.loc.start);
    }

    const compiled = await compileStyleAsync({
      filename: "input.vue",
      id: "data-v-imgfmt",
      scoped: block.scoped === true,
      source: styleSource,
      trim: true,
    });
    const compileError = compiled.errors[0];

    if (compileError !== undefined) {
      throw offsetVueStyleError(compileError, block.loc.start);
    }

    output.push(compiled.code);
  }

  return output.join("\n\n");
}

async function compileSass(source: string): Promise<string> {
  const sass = await import("sass");
  const result = sass.compileString(source, {
    charset: false,
    logger: sass.Logger.silent,
    sourceMap: false,
    style: "expanded",
    syntax: "scss",
  });

  return result.css;
}

async function compileLess(source: string): Promise<string> {
  const compiler = await getLessCompiler();
  const result = await compiler.render(source, {
    filename: "input.less",
    javascriptEnabled: false,
    math: "parens-division",
  });

  return result.css;
}

async function getLessCompiler(): Promise<LessCompiler> {
  lessCompilerPromise ??= Promise.all([
    import("less/lib/less/index.js"),
    import("less/lib/less-browser/plugin-loader.js"),
    import("less/lib/less/default-options.js"),
  ]).then(([{ default: createLess }, { default: PluginLoader }, { default: defaultOptions }]) => {
    const compiler = createLess({}, []) as LessCompiler;

    compiler.PluginLoader = PluginLoader;
    compiler.options = defaultOptions();
    return compiler;
  });

  return lessCompilerPromise;
}

function readVueStyleLanguage(
  language: string | undefined,
  location: LocationDetails,
): "css" | CssPreprocessorLanguageId {
  if (language === undefined || language === "css") {
    return "css";
  }

  if (language === "scss" || language === "less") {
    return language;
  }

  throw new StylesheetPreprocessError(
    "vue",
    `Unsupported Vue <style lang="${language}">. Use CSS, SCSS or Less.`,
    location,
    undefined,
  );
}

function createVueError(error: unknown): StylesheetPreprocessError {
  return new StylesheetPreprocessError(
    "vue",
    readErrorMessage(error),
    readOneBasedLocation(error),
    error,
  );
}

function offsetVueStyleError(
  error: unknown,
  styleStart: LocationDetails,
): StylesheetPreprocessError {
  const local = readOneBasedLocation(error);
  const line =
    styleStart.line === undefined || local.line === undefined
      ? styleStart.line
      : styleStart.line + local.line - 1;
  const column =
    local.line === 1 && styleStart.column !== undefined && local.column !== undefined
      ? styleStart.column + local.column - 1
      : local.column;

  return new StylesheetPreprocessError("vue", readErrorMessage(error), { column, line }, error);
}

function normalizePreprocessError(
  language: Exclude<StylesheetLanguageId, "css">,
  error: unknown,
): StylesheetPreprocessError {
  if (error instanceof StylesheetPreprocessError) {
    return error;
  }

  const candidate = error as {
    readonly sassMessage?: unknown;
    readonly span?: {
      readonly start?: {
        readonly column?: unknown;
        readonly line?: unknown;
      };
    };
  };
  const message =
    typeof candidate.sassMessage === "string" ? candidate.sassMessage : readErrorMessage(error);
  const location =
    language === "scss"
      ? {
          column: incrementZeroBased(candidate.span?.start?.column),
          line: incrementZeroBased(candidate.span?.start?.line),
        }
      : language === "less"
        ? readLessLocation(error)
        : readOneBasedLocation(error);

  return new StylesheetPreprocessError(language, message, location, error);
}

function readErrorMessage(error: unknown): string {
  const candidate = error as {
    readonly message?: unknown;
    readonly reason?: unknown;
  };

  if (typeof candidate.reason === "string") {
    return candidate.reason;
  }

  return typeof candidate.message === "string" ? candidate.message : String(error);
}

function readLessLocation(error: unknown): LocationDetails {
  const candidate = error as {
    readonly column?: unknown;
    readonly line?: unknown;
  };

  return {
    column: incrementZeroBased(candidate.column),
    line: positiveInteger(candidate.line),
  };
}

function readOneBasedLocation(error: unknown): LocationDetails {
  const candidate = error as {
    readonly column?: unknown;
    readonly line?: unknown;
    readonly loc?: {
      readonly start?: {
        readonly column?: unknown;
        readonly line?: unknown;
      };
    };
  };

  return {
    column: positiveInteger(candidate.loc?.start?.column ?? candidate.column),
    line: positiveInteger(candidate.loc?.start?.line ?? candidate.line),
  };
}

function incrementZeroBased(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) + 1 : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}
