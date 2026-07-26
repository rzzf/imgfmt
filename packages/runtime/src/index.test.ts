import { describe, expect, it } from "vite-plus/test";

import {
  generateRuntimeSource,
  serializeCapabilityState,
  type FormatProbeDefinition,
} from "./index";

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
  probes: [{ uri: "data:image/avif;base64,test", width: 1, height: 1 }],
};
const webpFormat: FormatProbeDefinition = {
  id: "webp",
  probes: [{ uri: "data:image/webp;base64,test", width: 1, height: 1 }],
};
const formats: readonly FormatProbeDefinition[] = [avifFormat, webpFormat];

describe("serializeCapabilityState", () => {
  it("emits a deterministic complete truth vector", () => {
    expect(
      serializeCapabilityState({
        formats: ["avif", "webp", "jxl"],
        capabilities: {
          avif: true,
          webp: false,
        },
      }),
    ).toBe("ready avif no-webp no-jxl");
  });

  it.each(["constructor", "original", "prototype", "ready", "pending", "no-webp"])(
    "rejects reserved format id %s",
    (format) => {
      expect(() =>
        serializeCapabilityState({
          formats: [format],
          capabilities: {},
        }),
      ).toThrow(TypeError);
    },
  );

  it("rejects an empty format registry", () => {
    expect(() => serializeCapabilityState({ formats: [], capabilities: {} })).toThrow(TypeError);
  });
});

describe("generateRuntimeSource", () => {
  it("waits for every probe and commits once in registry order", () => {
    const harness = executeRuntime(generateRuntimeSource({ formats }));

    expect(harness.images).toHaveLength(2);
    expect(harness.commits).toEqual([]);

    succeed(imageAt(harness, 1));
    expect(harness.commits).toEqual([]);

    imageAt(harness, 0).onerror?.();
    expect(harness.commits).toEqual(["ready no-avif webp"]);

    harness.runDeadline();
    expect(harness.commits).toEqual(["ready no-avif webp"]);
  });

  it("treats unresolved probes as unsupported at the deadline", () => {
    const harness = executeRuntime(generateRuntimeSource({ formats, deadlineMs: 250 }));
    const lateLoad = imageAt(harness, 1).onload;

    succeed(imageAt(harness, 0));
    harness.runDeadline();

    expect(harness.commits).toEqual(["ready avif no-webp"]);

    lateLoad?.();
    expect(harness.commits).toEqual(["ready avif no-webp"]);
  });

  it("does not infer support from dimensions without a load event", () => {
    const harness = executeRuntime(generateRuntimeSource({ formats: [webpFormat] }));
    const image = imageAt(harness, 0);
    const lateLoad = image.onload;

    image.complete = true;
    image.naturalWidth = 1;
    image.naturalHeight = 1;
    harness.runDeadline();

    expect(harness.commits).toEqual(["ready no-webp"]);

    lateLoad?.();
    expect(harness.commits).toEqual(["ready no-webp"]);
  });

  it("requires the expected natural dimensions", () => {
    const harness = executeRuntime(generateRuntimeSource({ formats: [avifFormat] }));
    const image = imageAt(harness, 0);

    image.complete = true;
    image.naturalWidth = 2;
    image.naturalHeight = 1;
    image.onload?.();

    expect(harness.commits).toEqual(["ready no-avif"]);
  });

  it("combines multiple required probes for one format", () => {
    const harness = executeRuntime(
      generateRuntimeSource({
        formats: [
          {
            id: "webp",
            probes: [
              { uri: "data:image/webp;base64,lossy", width: 1, height: 1 },
              { uri: "data:image/webp;base64,alpha", width: 1, height: 1 },
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

  it("rejects duplicate formats", () => {
    expect(() => generateRuntimeSource({ formats: [avifFormat, avifFormat] })).toThrow(TypeError);
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
  // oxlint-disable-next-line typescript/no-implied-eval -- This test executes generated classic script source in an isolated surface.
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

  if (!image) {
    throw new RangeError(`Missing fake image at index ${index}.`);
  }

  return image;
}

function succeed(image: FakeImageSurface): void {
  image.complete = true;
  image.naturalWidth = 1;
  image.naturalHeight = 1;
  image.onload?.();
}
