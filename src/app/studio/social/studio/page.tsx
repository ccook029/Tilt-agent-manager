import { listAssets, listStudioAssets } from "@/lib/social/queries";
import { isDemoMode } from "@/lib/social/demo-data";
import { hasBlob } from "@/lib/social/env";
import type { Asset, StudioAsset } from "@/lib/social/db/schema";
import { StudioClient } from "./StudioClient";

export const dynamic = "force-dynamic";

/**
 * Studio — the freeform side of the agent. Generate any Tilt-branded piece
 * (desktop background, phone wallpaper, poster, banner) from a plain-language
 * request. It carries the same brand knowledge, guardrails, and real photo
 * library as the social planner, so output is unmistakably Tilt.
 */
export default async function StudioPage() {
  let photos: Asset[] = [];
  let gallery: StudioAsset[] = [];
  let error: string | null = null;
  try {
    [photos, gallery] = await Promise.all([
      listAssets({ type: "photo", limit: 200 }),
      listStudioAssets(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const env = {
    demoMode: isDemoMode(),
    // OIDC-aware: Blob works on Vercel via a read-write token OR an OIDC
    // connection (the dashboard default), so check both, not just the token.
    blob: hasBlob(),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  // Trim photos to the lightweight shape the picker needs.
  const photoChoices = photos
    .filter((p) => p.blobUrl)
    .map((p) => ({
      id: p.id,
      filename: p.filename,
      thumb: p.blobUrl as string,
      description: p.tags?.description ?? null,
    }));

  return (
    <div className="container">
      <p className="tagline">Freeform · brand content</p>
      <h1>Studio</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 720 }}>
        Generate any Tilt-branded piece you need — a desktop background, a phone
        wallpaper, a poster, a banner. The Studio already knows our voice, colors,
        and hard rules, and can build on a real photo from the catalog. The TILT
        logo is always composited by code, never AI-drawn.
      </p>

      <StudioClient env={env} photos={photoChoices} initialGallery={gallery} error={error} />
    </div>
  );
}
