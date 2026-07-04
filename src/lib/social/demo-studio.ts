import type { StudioAsset } from "@/lib/social/db/schema";

/**
 * Demo Studio gallery for preview mode (no DATABASE_URL). Shows what freeform,
 * on-brand pieces the Studio produces — a desktop background, a phone wallpaper —
 * so the /studio screen is fully clickable with zero backend. The real Studio
 * (generateStudioAsset) replaces these with live generations.
 */

function mk(p: Partial<StudioAsset> & { kind: string; title: string }): StudioAsset {
  return {
    id: p.id ?? `demo-studio-${p.title}`,
    kind: p.kind,
    title: p.title,
    prompt: p.prompt ?? "",
    brief: p.brief ?? null,
    displayText: p.displayText ?? null,
    width: p.width ?? 1920,
    height: p.height ?? 1080,
    baseAssetId: p.baseAssetId ?? null,
    logo: p.logo ?? true,
    renderUrl: p.renderUrl ?? null,
    createdAt: p.createdAt ?? new Date(),
  };
}

export const DEMO_STUDIO: StudioAsset[] = [
  mk({
    id: "demo-studio-1",
    kind: "desktop",
    title: "Don't Be A Sheep desktop",
    prompt: "A desktop background for the company — bold, dark, cyan energy, our tagline.",
    brief:
      "Abstract brand graphic: deep black field with a sweeping cyan light arc from the top-right, subtle carbon-weave texture, oversized condensed wordmark. Clean lower-right for the logo.",
    displayText: "DON'T BE A SHEEP",
    width: 1920,
    height: 1080,
    renderUrl: "/demo/studio/desktop-sheep.svg",
  }),
  mk({
    id: "demo-studio-2",
    kind: "phone",
    title: "Go Full Tilt phone wallpaper",
    prompt: "Phone wallpaper, minimal, brand colors, Go Full Tilt.",
    brief:
      "Vertical abstract: tilted cyan slash across black, high-contrast geometry, condensed display type stacked low. Negative space lower-right for the logo.",
    displayText: "GO FULL TILT",
    width: 1170,
    height: 2532,
    renderUrl: "/demo/studio/phone-tilt.svg",
  }),
];
