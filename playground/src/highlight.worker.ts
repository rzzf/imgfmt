import { highlightCode } from "./highlight";
import type { HighlightRequest, HighlightResponse } from "./highlight-protocol";

self.addEventListener("message", (event: MessageEvent<HighlightRequest>): void => {
  const request = event.data;

  void highlightCode(request.code, request.language)
    .then((tokens): void => {
      const response: HighlightResponse = {
        kind: "success",
        requestId: request.requestId,
        target: request.target,
        tokens,
      };

      self.postMessage(response);
    })
    .catch((error: unknown): void => {
      const response: HighlightResponse = {
        kind: "failure",
        message: error instanceof Error ? error.message : String(error),
        requestId: request.requestId,
        target: request.target,
      };

      self.postMessage(response);
    });
});
