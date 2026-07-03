import type { Asset } from "@/lib/social/db/schema";
import type { PostSlot } from "./schedule";

/**
 * Code-side candidate matching (Phase 2). Filters the tagged catalog down to the
 * assets most relevant to a slot's pillar/format, ranked. The brain then makes
 * the final pick (or declares a gap) and writes the render brief.
 */

export type RankedAsset = { asset: Asset; score: number; reason: string };

export function rankCandidates(slot: PostSlot, assets: Asset[]): RankedAsset[] {
  const wantVideo = slot.formatHint === "reel";
  const ranked: RankedAsset[] = [];

  for (const a of assets) {
    const tags = a.tags ?? {};
    const pillars = tags.pillars ?? [];
    let score = 0;
    const reasons: string[] = [];

    if (pillars.includes(slot.pillarId)) {
      score += 5;
      reasons.push(`tagged for pillar ${slot.pillarId}`);
    }
    // Format fit: reels want video, static/carousel want photos.
    if (wantVideo && a.type === "video") {
      score += 3;
      reasons.push("video matches reel");
    }
    if (!wantVideo && a.type === "photo") {
      score += 3;
      reasons.push("photo matches static/carousel");
    }
    // Pillar-specific signal from tags.
    if (slot.pillarKey === "athletes" && tags.person) {
      score += 2;
      reasons.push(`features ${tags.person}`);
    }
    if (slot.pillarKey === "product" && tags.product) {
      score += 2;
      reasons.push(`shows ${tags.product}`);
    }
    if (slot.pillarKey === "proof" && tags.action === "action") {
      score += 2;
      reasons.push("action shot");
    }
    if (slot.pillarKey === "community" && tags.setting === "rink") {
      score += 1;
      reasons.push("rink setting");
    }

    if (score > 0) {
      ranked.push({ asset: a, score, reason: reasons.join(", ") });
    }
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, 6);
}
