import browserRuntime from "./browser-runtime.js";

interface BrowserRuntimeProbe {
  readonly formatIndex: number;
  readonly height: number;
  readonly uri: string;
  readonly width: number;
}

export interface BrowserRuntimeConfiguration {
  readonly attribute: string;
  readonly deadlineMs: number;
  readonly formats: readonly string[];
  readonly pending: string;
  readonly probes: readonly BrowserRuntimeProbe[];
  readonly ready: string;
}

const browserRuntimeSource = browserRuntime.toString();
const unsupportedClassicSyntax = /\b(?:async|await|class|const|let|Promise)\b|=>/;

export function renderBrowserRuntime(configuration: BrowserRuntimeConfiguration): string {
  if (
    !browserRuntimeSource.startsWith("function") ||
    unsupportedClassicSyntax.test(browserRuntimeSource)
  ) {
    throw new Error("imgfmt browser runtime must remain an ES5-compatible function");
  }

  const serializedConfiguration = serializeForClassicScript(configuration);
  return `(${browserRuntimeSource})(document, Image, setTimeout, clearTimeout, ${serializedConfiguration});\n`;
}

function serializeForClassicScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
