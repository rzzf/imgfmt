import "./styles.css";
import type { CompileRequest, CompileResponse } from "./compiler-protocol";
import { formatPresets, isFormatPresetId, type FormatPresetId } from "./formats";
import type { HighlightedLines, HighlightLanguage } from "./highlight";
import type { HighlightRequest, HighlightResponse, HighlightTarget } from "./highlight-protocol";
import type { CssEditors } from "./monaco-editors";
import {
  getStylesheetLanguage,
  isStylesheetLanguageId,
  stylesheetLanguages,
  type StylesheetLanguageId,
} from "./stylesheets";
import {
  getToolDefinition,
  isBuildToolId,
  tools,
  type BuildToolId,
  type ToolDefinition,
} from "./tools";

const storageKeys = {
  format: "imgfmt-playground-format",
  language: "imgfmt-playground-language",
  legacySource: "imgfmt-playground-source",
  sourcePrefix: "imgfmt-playground-source-",
  tool: "imgfmt-playground-tool",
} as const;

const inputEditor = requiredElement<HTMLTextAreaElement>("#input-css");
const inputHost = requiredElement<HTMLElement>("#input-editor");
const configFallback = requiredElement<HTMLElement>("#config-fallback");
const configHost = requiredElement<HTMLElement>("#config-editor");
const outputCode = requiredElement<HTMLElement>("#output-css");
const outputFallback = requiredElement<HTMLElement>("#output-fallback");
const outputHost = requiredElement<HTMLElement>("#output-editor");
const outputPanel = requiredElement<HTMLElement>(".output-panel");
const outputMeta = requiredElement<HTMLElement>("#output-meta");
const compileStatus = requiredElement<HTMLElement>("#compile-status");
const statusLabel = requiredElement<HTMLElement>("#compile-status strong");
const editorEngine = requiredElement<HTMLElement>("#editor-engine");
const highlightStatus = requiredElement<HTMLElement>("#highlight-status");
const toolTabs = requiredElement<HTMLElement>("#tool-tabs");
const formatSelect = requiredElement<HTMLSelectElement>("#format-preset");
const languageSelect = requiredElement<HTMLSelectElement>("#input-language");
const inputFile = requiredElement<HTMLElement>("#input-file");
const integrationMode = requiredElement<HTMLElement>("#integration-mode");
const integrationFile = requiredElement<HTMLElement>("#integration-file");
const integrationSnippet = requiredElement<HTMLElement>("#integration-snippet");
const resetButton = requiredElement<HTMLButtonElement>("#reset-input");
const copyOutputButton = requiredElement<HTMLButtonElement>("#copy-output");
const copySnippetButton = requiredElement<HTMLButtonElement>("#copy-snippet");
const compilerWorker = new Worker(new URL("./compiler.worker.ts", import.meta.url), {
  type: "module",
});
const highlightWorker = new Worker(new URL("./highlight.worker.ts", import.meta.url), {
  type: "module",
});

let selectedTool = readStoredTool();
let selectedFormat = readStoredFormat();
let selectedLanguage = readStoredLanguage();
let activeRequestId = 0;
let nextHighlightRequestId = 0;
const activeHighlightRequestIds: Record<HighlightTarget, number> = {
  output: 0,
  snippet: 0,
};
let compileTimer: number | undefined;
let cssEditors: CssEditors | undefined;
let latestOutput = "";
let displayedOutput = "";
let latestSnippet = "";
let announcedHighlightFailure = false;

inputEditor.value = readInitialSource(selectedLanguage);

inputEditor.addEventListener("input", (): void => {
  handleInput(inputEditor.value);
});

inputEditor.addEventListener("keydown", (event): void => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    scheduleCompile(0);
  }
});

formatSelect.addEventListener("change", (): void => {
  if (!isFormatPresetId(formatSelect.value)) {
    return;
  }

  selectedFormat = formatSelect.value;
  writeStorage(storageKeys.format, selectedFormat);
  renderIntegration(getToolDefinition(selectedTool));
  scheduleCompile(0);
});

languageSelect.addEventListener("change", (): void => {
  if (!isStylesheetLanguageId(languageSelect.value)) {
    return;
  }

  selectedLanguage = languageSelect.value;
  writeStorage(storageKeys.language, selectedLanguage);
  renderInputLanguage();
  cssEditors?.setInputLanguage(selectedLanguage);
  const source = readLanguageSource(selectedLanguage);

  if (cssEditors === undefined) {
    inputEditor.value = source;
    handleInput(source);
  } else {
    cssEditors.setInputValue(source);
  }

  scheduleCompile(0);
});

resetButton.addEventListener("click", (): void => {
  const defaultSource = getStylesheetLanguage(selectedLanguage).defaultSource;

  if (cssEditors === undefined) {
    inputEditor.value = defaultSource;
    handleInput(defaultSource);
    inputEditor.focus();
  } else {
    cssEditors.setInputValue(defaultSource);
    cssEditors.focusInput();
  }

  writeStorage(sourceStorageKey(selectedLanguage), defaultSource);
  scheduleCompile(0);
});

copyOutputButton.addEventListener("click", (): void => {
  void copyText(latestOutput, copyOutputButton);
});

copySnippetButton.addEventListener("click", (): void => {
  void copyText(latestSnippet, copySnippetButton);
});

compilerWorker.addEventListener("message", (event: MessageEvent<CompileResponse>): void => {
  const response = event.data;

  if (response.requestId !== activeRequestId) {
    return;
  }

  if (response.kind === "failure") {
    renderCompileFailure(response);
    return;
  }

  latestOutput = response.css;
  renderOutput(response.css, true);
  outputPanel.dataset.state = "success";
  setCompileStatus("success", "Compiled");
  const warningLabel = response.warningCount === 0 ? "" : ` · ${response.warningCount} warnings`;
  outputMeta.textContent = `${response.readyRuleCount} rules · ${response.durationMs.toFixed(1)} ms${warningLabel}`;
});

compilerWorker.addEventListener("error", (event): void => {
  event.preventDefault();
  latestOutput = "";
  renderOutput("/* Compiler worker unavailable. Reload the page and try again. */", false);
  outputPanel.dataset.state = "error";
  outputMeta.textContent = "";
  setCompileStatus("error", "Unavailable");
});

highlightWorker.addEventListener("message", (event: MessageEvent<HighlightResponse>): void => {
  const response = event.data;

  if (response.requestId !== activeHighlightRequestIds[response.target]) {
    return;
  }

  if (response.kind === "failure") {
    markHighlightUnavailable(response.target);
    return;
  }

  renderHighlightedCode(response.target, response.tokens);
});

highlightWorker.addEventListener("error", (event): void => {
  event.preventDefault();
  markHighlightUnavailable("output");
  markHighlightUnavailable("snippet");
});

window.addEventListener("beforeunload", (): void => {
  cssEditors?.dispose();
  compilerWorker.terminate();
  highlightWorker.terminate();
});

renderFormatOptions();
renderLanguageOptions();
renderToolTabs();
renderIntegration(getToolDefinition(selectedTool));
scheduleCompile(0);
void initializeCssEditors();

function renderFormatOptions(): void {
  for (const preset of formatPresets) {
    const option = document.createElement("option");

    option.value = preset.id;
    option.textContent = preset.label;
    option.selected = preset.id === selectedFormat;
    formatSelect.append(option);
  }
}

function renderLanguageOptions(): void {
  for (const language of stylesheetLanguages) {
    const option = document.createElement("option");

    option.value = language.id;
    option.textContent = language.label;
    option.selected = language.id === selectedLanguage;
    languageSelect.append(option);
  }

  renderInputLanguage();
}

function renderInputLanguage(): void {
  const language = getStylesheetLanguage(selectedLanguage);

  inputFile.textContent = `input.${language.extension}`;
  languageSelect.title = `${language.label} input`;
}

function renderToolTabs(): void {
  for (const tool of tools) {
    const button = document.createElement("button");

    button.type = "button";
    button.role = "tab";
    button.dataset.tool = tool.id;
    button.ariaSelected = String(tool.id === selectedTool);
    button.tabIndex = tool.id === selectedTool ? 0 : -1;
    button.textContent = tool.label;
    button.title = `${tool.label} · ${tool.mode}`;
    button.addEventListener("click", (): void => {
      selectTool(tool.id);
    });
    button.addEventListener("keydown", (event): void => {
      handleToolKeydown(event, tool.id);
    });
    toolTabs.append(button);
  }
}

function selectTool(id: BuildToolId): void {
  selectedTool = id;
  writeStorage(storageKeys.tool, id);
  updateActiveToolTab();
  renderIntegration(getToolDefinition(id));
  scheduleCompile(0);
}

function updateActiveToolTab(): void {
  for (const button of toolTabs.querySelectorAll<HTMLButtonElement>("button[data-tool]")) {
    const active = button.dataset.tool === selectedTool;

    button.ariaSelected = String(active);
    button.tabIndex = active ? 0 : -1;
  }
}

function handleToolKeydown(event: KeyboardEvent, currentId: BuildToolId): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    return;
  }

  event.preventDefault();
  const currentIndex = tools.findIndex((tool) => tool.id === currentId);
  let nextIndex: number;

  if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = tools.length - 1;
  } else {
    const direction = event.key === "ArrowRight" ? 1 : -1;
    nextIndex = (currentIndex + direction + tools.length) % tools.length;
  }

  const nextTool = tools[nextIndex];

  if (nextTool !== undefined) {
    selectTool(nextTool.id);
    toolTabs.querySelector<HTMLButtonElement>(`button[data-tool="${nextTool.id}"]`)?.focus();
  }
}

function renderIntegration(tool: ToolDefinition): void {
  integrationMode.textContent = tool.mode;
  integrationMode.dataset.mode = tool.mode === "Manual CSS" ? "manual" : "automatic";
  integrationFile.textContent = tool.fileName;
  latestSnippet = tool.snippet(selectedFormat);

  if (cssEditors === undefined) {
    requestHighlight("snippet", latestSnippet, "typescript");
  } else {
    renderPlainCode("snippet", latestSnippet);
    cssEditors.setConfigValue(latestSnippet);
  }
}

function handleInput(value: string): void {
  if (inputEditor.value !== value) {
    inputEditor.value = value;
  }

  writeStorage(sourceStorageKey(selectedLanguage), value);
  scheduleCompile();
}

function scheduleCompile(delay = 180): void {
  activeRequestId += 1;

  if (compileTimer !== undefined) {
    window.clearTimeout(compileTimer);
  }

  compileTimer = window.setTimeout((): void => {
    compileTimer = undefined;
    requestCompile();
  }, delay);
}

function requestCompile(): void {
  const request: CompileRequest = {
    formatPreset: selectedFormat,
    inputLanguage: selectedLanguage,
    requestId: activeRequestId,
    source: cssEditors?.getInputValue() ?? inputEditor.value,
    tool: selectedTool,
  };

  outputPanel.dataset.state = "compiling";
  outputMeta.textContent = "";
  setCompileStatus("compiling", "Compiling");
  compilerWorker.postMessage(request);
}

function renderCompileFailure(
  response: Extract<CompileResponse, { readonly kind: "failure" }>,
): void {
  const location =
    response.line === undefined
      ? ""
      : ` at ${response.line}${response.column === undefined ? "" : `:${response.column}`}`;
  const failure = response.stage === "preprocess" ? "Preprocess failed" : "Transform failed";

  latestOutput = "";
  renderOutput(`/* ${failure}${location}\n\n${response.message}\n*/`, false);
  outputPanel.dataset.state = "error";
  outputMeta.textContent =
    response.stage === "preprocess"
      ? `${getStylesheetLanguage(selectedLanguage).label} input error`
      : location.length === 0
        ? "Input error"
        : location.slice(4);
  setCompileStatus("error", "Error");
}

function renderOutput(code: string, highlighted: boolean): void {
  displayedOutput = code;

  if (highlighted && cssEditors === undefined) {
    requestHighlight("output", code, "css");
  } else {
    renderPlainCode("output", code);
  }

  cssEditors?.setOutputValue(code);
}

async function initializeCssEditors(): Promise<void> {
  try {
    const { createCssEditors } = await import("./monaco-editors");
    const editors = await createCssEditors({
      configContainer: configHost,
      initialConfig: latestSnippet,
      initialInput: inputEditor.value,
      initialInputLanguage: selectedLanguage,
      initialOutput: displayedOutput,
      inputContainer: inputHost,
      onInput: handleInput,
      onRun: (): void => {
        scheduleCompile(0);
      },
      outputContainer: outputHost,
    });

    cssEditors = editors;
    editors.setInputLanguage(selectedLanguage);
    editors.setInputValue(inputEditor.value);
    editors.setConfigValue(latestSnippet);
    editors.setOutputValue(displayedOutput);
    inputEditor.hidden = true;
    configFallback.hidden = true;
    outputFallback.hidden = true;
    inputHost.dataset.editorState = "ready";
    configHost.dataset.editorState = "ready";
    outputHost.dataset.editorState = "ready";
    inputHost.removeAttribute("aria-busy");
    configHost.removeAttribute("aria-busy");
    outputHost.removeAttribute("aria-busy");
    editorEngine.textContent = "Shiki · Monaco";
  } catch {
    inputHost.dataset.editorState = "failed";
    configHost.dataset.editorState = "failed";
    outputHost.dataset.editorState = "failed";
    inputHost.removeAttribute("aria-busy");
    configHost.removeAttribute("aria-busy");
    outputHost.removeAttribute("aria-busy");
    editorEngine.textContent = "Basic editor";
    highlightStatus.textContent =
      "The enhanced code editor could not load; the plain-text editor remains available.";
  }
}

function requestHighlight(
  target: HighlightTarget,
  code: string,
  language: HighlightLanguage,
): void {
  nextHighlightRequestId += 1;
  const request: HighlightRequest = {
    code,
    language,
    requestId: nextHighlightRequestId,
    target,
  };

  activeHighlightRequestIds[target] = request.requestId;
  const element = highlightedElement(target);
  const container = element.parentElement;

  element.textContent = code;
  element.dataset.highlightState = "loading";
  container?.setAttribute("aria-busy", "true");
  highlightWorker.postMessage(request);
}

function renderPlainCode(target: HighlightTarget, code: string): void {
  nextHighlightRequestId += 1;
  activeHighlightRequestIds[target] = nextHighlightRequestId;
  const element = highlightedElement(target);

  element.textContent = code;
  element.dataset.highlightState = "plain";
  element.parentElement?.removeAttribute("aria-busy");
}

function renderHighlightedCode(target: HighlightTarget, lines: HighlightedLines): void {
  const element = highlightedElement(target);
  const container = element.parentElement;
  const scrollLeft = container?.scrollLeft ?? 0;
  const scrollTop = container?.scrollTop ?? 0;
  const fragment = document.createDocumentFragment();

  for (const [lineIndex, line] of lines.entries()) {
    for (const token of line) {
      const span = document.createElement("span");
      const decorations: string[] = [];
      const fontStyle = token.fontStyle ?? 0;

      span.className = "shiki-token";
      span.textContent = token.content;

      if (token.color !== undefined) {
        span.style.color = token.color;
      }

      if ((fontStyle & 1) !== 0) {
        span.style.fontStyle = "italic";
      }

      if ((fontStyle & 2) !== 0) {
        span.style.fontWeight = "700";
      }

      if ((fontStyle & 4) !== 0) {
        decorations.push("underline");
      }

      if ((fontStyle & 8) !== 0) {
        decorations.push("line-through");
      }

      if (decorations.length !== 0) {
        span.style.textDecoration = decorations.join(" ");
      }

      fragment.append(span);
    }

    if (lineIndex < lines.length - 1) {
      fragment.append("\n");
    }
  }

  element.replaceChildren(fragment);
  element.dataset.highlightState = "ready";
  container?.removeAttribute("aria-busy");

  if (container !== null && container !== undefined) {
    container.scrollLeft = scrollLeft;
    container.scrollTop = scrollTop;
  }
}

function markHighlightUnavailable(target: HighlightTarget): void {
  const element = highlightedElement(target);

  element.dataset.highlightState = "unavailable";
  element.parentElement?.removeAttribute("aria-busy");

  if (!announcedHighlightFailure) {
    announcedHighlightFailure = true;
    highlightStatus.textContent =
      "Configuration highlighting is unavailable; code remains readable as plain text.";
  }
}

function highlightedElement(target: HighlightTarget): HTMLElement {
  return target === "output" ? outputCode : integrationSnippet;
}

function setCompileStatus(state: "compiling" | "error" | "success", label: string): void {
  compileStatus.dataset.state = state;
  statusLabel.textContent = label;
}

async function copyText(text: string, button: HTMLButtonElement): Promise<void> {
  if (text.length === 0) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Failed";
  }

  window.setTimeout((): void => {
    button.textContent = "Copy";
  }, 1400);
}

function readStoredTool(): BuildToolId {
  const value = readStorage(storageKeys.tool);
  return value !== undefined && isBuildToolId(value) ? value : "vite";
}

function readStoredFormat(): FormatPresetId {
  const value = readStorage(storageKeys.format);
  return value !== undefined && isFormatPresetId(value) ? value : "default";
}

function readStoredLanguage(): StylesheetLanguageId {
  const value = readStorage(storageKeys.language);
  return value !== undefined && isStylesheetLanguageId(value) ? value : "css";
}

function readInitialSource(language: StylesheetLanguageId): string {
  return (
    readStorage(sourceStorageKey(language)) ??
    (language === "css" ? readStorage(storageKeys.legacySource) : undefined) ??
    getStylesheetLanguage(language).defaultSource
  );
}

function readLanguageSource(language: StylesheetLanguageId): string {
  return readStorage(sourceStorageKey(language)) ?? getStylesheetLanguage(language).defaultSource;
}

function sourceStorageKey(language: StylesheetLanguageId): string {
  return `${storageKeys.sourcePrefix}${language}`;
}

function readStorage(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing or an embedded context may disable storage.
  }
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (element === null) {
    throw new Error(`Missing playground element: ${selector}`);
  }

  return element;
}
