/**
 * Studio output presets — the canvas sizes the founder can ask for.
 *
 * The Studio is the freeform side of the agent: instead of the social calendar's
 * fixed feed crops, it produces one-off brand pieces (a desktop background, a
 * phone wallpaper, a poster) at the dimensions those actually need. Pick a preset
 * or supply custom width/height.
 */

export type StudioPreset = {
  key: string;
  label: string;
  /** Short hint shown under the label. */
  hint: string;
  width: number;
  height: number;
};

export const STUDIO_PRESETS: StudioPreset[] = [
  { key: "desktop", label: "Desktop background", hint: "16:9 · 1920×1080", width: 1920, height: 1080 },
  { key: "desktop_wide", label: "Ultrawide desktop", hint: "21:9 · 2560×1080", width: 2560, height: 1080 },
  { key: "phone", label: "Phone wallpaper", hint: "9:19.5 · 1170×2532", width: 1170, height: 2532 },
  { key: "square", label: "Square graphic", hint: "1:1 · 1080×1080", width: 1080, height: 1080 },
  { key: "story", label: "Story / vertical", hint: "9:16 · 1080×1920", width: 1080, height: 1920 },
  { key: "banner", label: "Banner / header", hint: "16:5 · 1600×500", width: 1600, height: 500 },
  { key: "poster", label: "Poster (portrait)", hint: "4:5 · 1080×1350", width: 1080, height: 1350 },
];

export const DEFAULT_PRESET = STUDIO_PRESETS[0];

const MIN_DIM = 256;
const MAX_DIM = 4096;

/** Resolves a preset key (or custom dims) to clamped pixel dimensions. */
export function resolveDimensions(input: {
  preset?: string;
  width?: number;
  height?: number;
}): { width: number; height: number; presetKey: string } {
  if (input.preset === "custom" && input.width && input.height) {
    return {
      width: clamp(input.width),
      height: clamp(input.height),
      presetKey: "custom",
    };
  }
  const p = STUDIO_PRESETS.find((x) => x.key === input.preset) ?? DEFAULT_PRESET;
  return { width: p.width, height: p.height, presetKey: p.key };
}

function clamp(n: number): number {
  return Math.max(MIN_DIM, Math.min(MAX_DIM, Math.round(n)));
}
