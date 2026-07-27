export type FormatPresetId = "avif" | "default" | "webp";

export interface FormatPreset {
  readonly formatIds: readonly ("avif" | "webp")[];
  readonly id: FormatPresetId;
  readonly label: string;
}

export const formatPresets: readonly FormatPreset[] = [
  {
    formatIds: ["avif", "webp"],
    id: "default",
    label: "AVIF → WebP",
  },
  {
    formatIds: ["webp"],
    id: "webp",
    label: "WebP only",
  },
  {
    formatIds: ["avif"],
    id: "avif",
    label: "AVIF only",
  },
];

const validPresetIds: ReadonlySet<string> = new Set(formatPresets.map((preset) => preset.id));

export function getFormatPreset(id: FormatPresetId): FormatPreset {
  const preset = formatPresets.find((candidate) => candidate.id === id);

  if (preset === undefined) {
    throw new TypeError(`Unknown format preset: ${id}`);
  }

  return preset;
}

export function isFormatPresetId(value: string): value is FormatPresetId {
  return validPresetIds.has(value);
}
