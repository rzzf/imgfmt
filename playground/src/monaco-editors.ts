import css from "@shikijs/langs/css";
import less from "@shikijs/langs/less";
import scss from "@shikijs/langs/scss";
import typescript from "@shikijs/langs/typescript";
import vue from "@shikijs/langs/vue";
import { shikiToMonaco } from "@shikijs/monaco";
import vitesseDark from "@shikijs/themes/vitesse-dark";
import * as monaco from "monaco-editor-core";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import EditorWorker from "./monaco.worker?worker";
import type { StylesheetLanguageId } from "./stylesheets";

export interface CssEditors {
  dispose(): void;
  focusInput(): void;
  getInputValue(): string;
  setConfigValue(value: string): void;
  setInputLanguage(language: StylesheetLanguageId): void;
  setInputValue(value: string): void;
  setOutputValue(value: string): void;
}

export interface CreateCssEditorsOptions {
  readonly configContainer: HTMLElement;
  readonly initialConfig: string;
  readonly initialInput: string;
  readonly initialInputLanguage: StylesheetLanguageId;
  readonly initialOutput: string;
  readonly inputContainer: HTMLElement;
  readonly onInput: (value: string) => void;
  readonly onRun: () => void;
  readonly outputContainer: HTMLElement;
}

const highlighterPromise = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [css, less, scss, typescript, vue],
  themes: [vitesseDark],
});

export async function createCssEditors(options: CreateCssEditorsOptions): Promise<CssEditors> {
  const highlighter = await highlighterPromise;

  Reflect.set(globalThis, "MonacoEnvironment", {
    getWorker: (): Worker => new EditorWorker(),
  });

  for (const id of ["css", "less", "scss", "typescript", "vue"]) {
    if (!monaco.languages.getLanguages().some((language) => language.id === id)) {
      monaco.languages.register({ id });
    }
  }

  shikiToMonaco(highlighter, monaco, {
    tokenizeMaxLineLength: 20_000,
    tokenizeTimeLimit: 100,
  });

  const inputSurface = createSurface(options.inputContainer, "input-monaco");
  const configSurface = createSurface(options.configContainer, "config-monaco");
  const outputSurface = createSurface(options.outputContainer, "output-monaco");
  const inputUri = monaco.Uri.parse("inmemory://imgfmt/input.css");
  const configUri = monaco.Uri.parse("inmemory://imgfmt/config.ts");
  const outputUri = monaco.Uri.parse("inmemory://imgfmt/output.css");

  monaco.editor.getModel(inputUri)?.dispose();
  monaco.editor.getModel(configUri)?.dispose();
  monaco.editor.getModel(outputUri)?.dispose();

  const inputModel = monaco.editor.createModel(
    options.initialInput,
    options.initialInputLanguage,
    inputUri,
  );
  const configModel = monaco.editor.createModel(options.initialConfig, "typescript", configUri);
  const outputModel = monaco.editor.createModel(options.initialOutput, "css", outputUri);
  const sharedOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
    ariaLabel: "Code editor",
    automaticLayout: true,
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    bracketPairColorization: { enabled: true },
    contextmenu: true,
    cursorBlinking: "smooth",
    cursorSmoothCaretAnimation: "on",
    detectIndentation: false,
    fixedOverflowWidgets: true,
    folding: false,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    fontLigatures: false,
    fontSize: 13,
    glyphMargin: false,
    guides: { indentation: true },
    insertSpaces: true,
    lineDecorationsWidth: 8,
    lineHeight: 22,
    lineNumbers: "on",
    lineNumbersMinChars: 3,
    matchBrackets: "always",
    minimap: { enabled: false },
    mouseWheelZoom: false,
    overviewRulerLanes: 0,
    padding: { bottom: 16, top: 16 },
    renderLineHighlight: "all",
    renderLineHighlightOnlyWhenFocus: true,
    renderWhitespace: "selection",
    roundedSelection: false,
    scrollBeyondLastLine: false,
    scrollbar: {
      alwaysConsumeMouseWheel: false,
      horizontalScrollbarSize: 10,
      verticalScrollbarSize: 10,
    },
    smoothScrolling: true,
    stickyScroll: { enabled: false },
    tabSize: 2,
    theme: "vitesse-dark",
    wordWrap: "off",
  };

  let inputEditor: monaco.editor.IStandaloneCodeEditor | undefined;
  let configEditor: monaco.editor.IStandaloneCodeEditor | undefined;
  let outputEditor: monaco.editor.IStandaloneCodeEditor | undefined;

  try {
    inputEditor = monaco.editor.create(inputSurface, {
      ...sharedOptions,
      ariaLabel: "Input stylesheet editor",
      model: inputModel,
    });
    configEditor = monaco.editor.create(configSurface, {
      ...sharedOptions,
      ariaLabel: "Build-tool configuration template",
      domReadOnly: true,
      model: configModel,
      readOnly: true,
      readOnlyMessage: { value: "The build-tool configuration template is read-only." },
      renderLineHighlight: "none",
    });
    outputEditor = monaco.editor.create(outputSurface, {
      ...sharedOptions,
      ariaLabel: "Output CSS editor",
      domReadOnly: true,
      model: outputModel,
      readOnly: true,
      readOnlyMessage: { value: "The transformed CSS is read-only." },
      renderLineHighlight: "none",
    });
  } catch (error: unknown) {
    inputEditor?.dispose();
    configEditor?.dispose();
    outputEditor?.dispose();
    inputModel.dispose();
    configModel.dispose();
    outputModel.dispose();
    inputSurface.remove();
    configSurface.remove();
    outputSurface.remove();
    throw error;
  }

  const inputSubscription = inputEditor.onDidChangeModelContent((): void => {
    options.onInput(inputModel.getValue());
  });

  inputEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, options.onRun);

  return {
    dispose(): void {
      inputSubscription.dispose();
      inputEditor.dispose();
      configEditor.dispose();
      outputEditor.dispose();
      inputModel.dispose();
      configModel.dispose();
      outputModel.dispose();
      inputSurface.remove();
      configSurface.remove();
      outputSurface.remove();
    },
    focusInput(): void {
      inputEditor.focus();
    },
    getInputValue(): string {
      return inputModel.getValue();
    },
    setConfigValue(value: string): void {
      if (configModel.getValue() !== value) {
        configModel.setValue(value);
      }
    },
    setInputLanguage(language: StylesheetLanguageId): void {
      monaco.editor.setModelLanguage(inputModel, language);
    },
    setInputValue(value: string): void {
      if (inputModel.getValue() !== value) {
        inputModel.setValue(value);
      }
    },
    setOutputValue(value: string): void {
      if (outputModel.getValue() !== value) {
        outputModel.setValue(value);
      }
    },
  };
}

function createSurface(container: HTMLElement, id: string): HTMLDivElement {
  const surface = document.createElement("div");

  surface.id = id;
  surface.className = "monaco-surface";
  container.append(surface);
  return surface;
}
