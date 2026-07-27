import { describe, expect, it } from "vite-plus/test";

import {
  generateRuntimeSource,
  serializeCapabilityState,
  type FormatProbeDefinition,
} from "../../src/runtime";
import {
  assertDocumentBootstrap,
  assertRuntimeMarkerAvailable,
  injectDocumentBootstrap,
} from "../../src/runtime/document";

interface FakeImageSurface {
  complete: boolean;
  height: number;
  naturalHeight: number;
  naturalWidth: number;
  onabort: (() => void) | null;
  onerror: (() => void) | null;
  onload: (() => void) | null;
  src: string;
  width: number;
}

interface RuntimeHarness {
  readonly commits: string[];
  readonly images: FakeImageSurface[];
  runDeadline(): void;
}

const avifFormat: FormatProbeDefinition = {
  id: "avif",
  probes: [{ height: 1, uri: "data:image/avif;base64,test", width: 1 }],
};
const webpFormat: FormatProbeDefinition = {
  id: "webp",
  probes: [{ height: 1, uri: "data:image/webp;base64,test", width: 1 }],
};
const formats: readonly FormatProbeDefinition[] = [avifFormat, webpFormat];

describe("serializeCapabilityState", () => {
  it("emits supported formats in deterministic registry order", () => {
    expect(
      serializeCapabilityState({
        capabilities: { avif: true, webp: false },
        formats: ["avif", "webp", "jxl"],
      }),
    ).toBe("ready avif");
  });
});

describe("generateRuntimeSource", () => {
  it("waits for every probe and commits once in registry order", () => {
    const harness = executeRuntime(generateRuntimeSource({ formats }));

    succeed(imageAt(harness, 1));
    expect(harness.commits).toEqual([]);

    imageAt(harness, 0).onerror?.();
    expect(harness.commits).toEqual(["ready webp"]);

    harness.runDeadline();
    expect(harness.commits).toEqual(["ready webp"]);
  });

  it("treats unresolved probes as unsupported at the deadline", () => {
    const harness = executeRuntime(generateRuntimeSource({ deadlineMs: 250, formats }));
    const lateLoad = imageAt(harness, 1).onload;

    succeed(imageAt(harness, 0));
    harness.runDeadline();

    expect(harness.commits).toEqual(["ready avif"]);
    lateLoad?.();
    expect(harness.commits).toEqual(["ready avif"]);
  });

  it("combines multiple required probes for one format", () => {
    const harness = executeRuntime(
      generateRuntimeSource({
        formats: [
          {
            id: "webp",
            probes: [
              { height: 1, uri: "data:image/webp;base64,lossy", width: 1 },
              { height: 1, uri: "data:image/webp;base64,alpha", width: 1 },
            ],
          },
        ],
      }),
    );

    succeed(imageAt(harness, 0));
    imageAt(harness, 1).onerror?.();

    expect(harness.commits).toEqual(["ready"]);
  });

  it("emits classic syntax without Promise APIs", () => {
    const source = generateRuntimeSource({ formats });
    expect(source).not.toMatch(/\b(?:const|let|class|Promise|async|await)\b|=>/);
  });

  it("generates the same source regardless of probe property order", () => {
    const first = generateRuntimeSource({
      formats: [
        {
          id: "webp",
          probes: [{ height: 1, uri: "data:image/webp;base64,test", width: 1 }],
        },
      ],
    });
    const second = generateRuntimeSource({
      formats: [
        {
          id: "webp",
          probes: [{ uri: "data:image/webp;base64,test", width: 1, height: 1 }],
        },
      ],
    });

    expect(first).toBe(second);
  });

  it("safely serializes arbitrary probe URIs into a script element", () => {
    const uri = "data:image/webp;base64,$&</script>\u2028\u2029";
    const source = generateRuntimeSource({
      formats: [{ id: "webp", probes: [{ height: 1, uri, width: 1 }] }],
    });
    const harness = executeRuntime(source);

    expect(source).not.toContain("</script>");
    expect(source).not.toContain("\u2028");
    expect(source).not.toContain("\u2029");
    expect(source).not.toContain("__IMGFMT_RUNTIME_CONFIGURATION__");
    expect(imageAt(harness, 0).src).toBe(uri);
  });
});

describe("document bootstrap", () => {
  it("ignores marker-like text inside raw-text elements", () => {
    const runtimeSource = "window.imgfmt = true;\n";
    const html = `<html><head>
      <script>window.template = "<i data-imgfmt-runtime>";</script>
      <style>.banner::before { content: "<i data-imgfmt-runtime>"; }</style>
    </head><body></body></html>`;

    expect(() => assertRuntimeMarkerAvailable(html)).not.toThrow();
    const transformed = injectDocumentBootstrap(html, runtimeSource);
    expect(() => assertDocumentBootstrap(transformed, runtimeSource)).not.toThrow();
  });

  it("rejects occupied markers and non-inline runtime attributes", () => {
    const runtimeSource = "window.imgfmt = true;\n";

    expect(() =>
      assertRuntimeMarkerAvailable(
        '<html><head><script data-imgfmt-runtime src="other.js"></script></head></html>',
      ),
    ).toThrow("owns the data-imgfmt-runtime attribute");

    const transformed = injectDocumentBootstrap(
      "<html><head></head><body></body></html>",
      runtimeSource,
    ).replace("<script ", "<script async ");

    expect(() => assertDocumentBootstrap(transformed, runtimeSource)).toThrow(
      "inline classic script",
    );
  });
});

function executeRuntime(source: string): RuntimeHarness {
  const commits: string[] = [];
  const images: FakeImageSurface[] = [];
  let state = "pending";
  let deadline: (() => void) | undefined;

  class FakeImage implements FakeImageSurface {
    complete = false;
    height = 0;
    naturalHeight = 0;
    naturalWidth = 0;
    onabort: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    src = "";
    width = 0;

    constructor() {
      images.push(this);
    }
  }

  const documentSurface = {
    documentElement: {
      getAttribute: (): string => state,
      setAttribute: (_name: string, value: string): void => {
        state = value;
        commits.push(value);
      },
    },
  };
  const setTimeoutSurface = (callback: () => void): number => {
    deadline = callback;
    return 1;
  };
  const clearTimeoutSurface = (): void => {
    deadline = undefined;
  };
  // oxlint-disable-next-line typescript/no-implied-eval -- Executes generated classic script in an isolated surface.
  const execute = Function("document", "Image", "setTimeout", "clearTimeout", source) as (
    documentValue: typeof documentSurface,
    imageValue: typeof FakeImage,
    setTimeoutValue: typeof setTimeoutSurface,
    clearTimeoutValue: typeof clearTimeoutSurface,
  ) => void;

  execute(documentSurface, FakeImage, setTimeoutSurface, clearTimeoutSurface);

  return {
    commits,
    images,
    runDeadline(): void {
      deadline?.();
    },
  };
}

function imageAt(harness: RuntimeHarness, index: number): FakeImageSurface {
  const image = harness.images[index];

  if (image === undefined) {
    throw new RangeError(`Missing fake image at index ${index}`);
  }

  return image;
}

function succeed(image: FakeImageSurface): void {
  image.complete = true;
  image.naturalHeight = 1;
  image.naturalWidth = 1;
  image.onload?.();
}
