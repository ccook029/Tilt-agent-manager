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
    // Static/carousel posts can only be branded from photos — the nano
    // pipeline can't treat video, so never offer videos for non-reel slots
    // (a pillar-tagged video used to outrank photos and then silently skip
    // rendering, leaving the post unbranded forever).
    if (!wantVideo && a.type === "video") continue;

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

  const sorted = ranked.sort((a, b) => b.score - a.score);

  // Reels can only be auto-cut from footage, so when the library has any
  // video candidates, offer only those — a pillar-tagged photo's higher score
  // used to win the slot and then sit unbranded forever (Shotstack can't cut
  // a still). Photos remain the fallback when no clip fits at all; the brain
  // then downgrades the post to a static treatment.
  if (wantVideo && sorted.some((r) => r.asset.type === "video")) {
    return sorted.filter((r) => r.asset.type === "video").slice(0, 6);
  }

  return sorted.slice(0, 6);
}

/**
 * The render pipelines are type-bound: nano brands photos, shotstack cuts
 * videos. If the brain pairs a kind with the wrong asset type, fix the kind so
 * the post can actually render instead of being skipped on every pass.
 */
export function coerceRenderKind<K extends string | null>(
  kind: K,
  asset: Pick<Asset, "type"> | null | undefined,
): K {
  if (!asset) return kind;
  if (kind === "shotstack" && asset.type === "photo") return "nano" as K;
  if (kind === "nano" && asset.type === "video") return "shotstack" as K;
  return kind;
}
