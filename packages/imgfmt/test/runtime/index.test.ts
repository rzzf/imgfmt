import { describe, expect, it } from "vite-plus/test";

import {
  generateRuntimeSource,
  serializeCapabilityState,
  type FormatProbeDefinition,
} from "../../src/runtime";

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
  it("emits a deterministic complete truth vector", () => {
    expect(
      serializeCapabilityState({
        capabilities: { avif: true, webp: false },
        formats: ["avif", "webp", "jxl"],
      }),
    ).toBe("ready avif no-webp no-jxl");
  });
});

describe("generateRuntimeSource", () => {
  it("waits for every probe and commits once in registry order", () => {
    const harness = executeRuntime(generateRuntimeSource({ formats }));

    succeed(imageAt(harness, 1));
    expect(harness.commits).toEqual([]);

    imageAt(harness, 0).onerror?.();
    expect(harness.commits).toEqual(["ready no-avif webp"]);

    harness.runDeadline();
    expect(harness.commits).toEqual(["ready no-avif webp"]);
  });

  it("treats unresolved probes as unsupported at the deadline", () => {
    const harness = executeRuntime(generateRuntimeSource({ deadlineMs: 250, formats }));
    const lateLoad = imageAt(harness, 1).onload;

    succeed(imageAt(harness, 0));
    harness.runDeadline();

    expect(harness.commits).toEqual(["ready avif no-webp"]);
    lateLoad?.();
    expect(harness.commits).toEqual(["ready avif no-webp"]);
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

    expect(harness.commits).toEqual(["ready no-webp"]);
  });

  it("emits classic syntax without Promise APIs", () => {
    const source = generateRuntimeSource({ formats });
    expect(source).not.toMatch(/\b(?:const|let|class|Promise|async|await)\b|=>/);
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
