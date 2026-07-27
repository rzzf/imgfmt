import { compileCss } from "./compile";
import type { CompileRequest, CompileResponse } from "./compiler-protocol";
import { StylesheetPreprocessError } from "./preprocess";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<CompileRequest>) => void): void;
  postMessage(message: CompileResponse): void;
}

interface ErrorDetails {
  readonly column?: number;
  readonly line?: number;
  readonly message: string;
  readonly stage: "preprocess" | "transform";
}

const workerScope = self as unknown as WorkerScope;

workerScope.addEventListener("message", (event): void => {
  void handleCompileRequest(event.data);
});

async function handleCompileRequest(request: CompileRequest): Promise<void> {
  try {
    const result = await compileCss(request);
    workerScope.postMessage({
      ...result,
      kind: "success",
      requestId: request.requestId,
    });
  } catch (error) {
    workerScope.postMessage({
      ...readError(error, request.inputLanguage === "css"),
      kind: "failure",
      requestId: request.requestId,
    });
  }
}

function readError(error: unknown, preserveTransformLocation: boolean): ErrorDetails {
  if (!(error instanceof Error)) {
    return { message: String(error), stage: "transform" };
  }

  const candidate = error as Error & {
    readonly column?: unknown;
    readonly line?: unknown;
    readonly reason?: unknown;
  };
  const stage = error instanceof StylesheetPreprocessError ? "preprocess" : "transform";
  const locationIsReliable = stage === "preprocess" || preserveTransformLocation;
  const line = locationIsReliable ? positiveInteger(candidate.line) : undefined;
  const column = locationIsReliable ? positiveInteger(candidate.column) : undefined;

  return {
    ...(column === undefined ? {} : { column }),
    ...(line === undefined ? {} : { line }),
    message: typeof candidate.reason === "string" ? candidate.reason : candidate.message,
    stage,
  };
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}
