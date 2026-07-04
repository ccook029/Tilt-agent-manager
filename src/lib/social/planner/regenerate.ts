import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { assets, posts, type Asset, type Post } from "@/lib/social/db/schema";
import { getActiveKbConfig } from "@/lib/social/kb/config";
import { generateSlot } from "@/lib/social/brain";
import { rankCandidates, coerceRenderKind } from "./assetMatch";
import type { Platform, PostSlot } from "./schedule";

/**
 * Phase 5 — regenerate a single post in place. The founder hits "Regenerate" on
 * one card; we reconstruct just that slot (date + pillar + platform + format),
 * re-rank candidate assets, and ask the brain for fresh copy for that one
 * platform. Sibling platform variants are left untouched. The post drops back to
 * "needs_review" so the new copy gets a human look.
 */
export async function regeneratePost(post: Post): Promise<Post> {
  const kb = await getActiveKbConfig();

  const pillar = kb.pillars.find(
    (p) => p.name === post.pillar || p.key === post.pillar,
  );
  if (!pillar) {
    throw new Error(`Unknown pillar "${post.pillar}" — can't regenerate.`);
  }

  const platform = post.platform as Platform;
  const slot: PostSlot = {
    date: post.scheduledDate ?? new Date().toISOString().slice(0, 10),
    pillarId: pillar.id,
    pillarKey: pillar.key,
    pillarName: pillar.name,
    platforms: [platform],
    formatHint: (post.format as PostSlot["formatHint"]) ?? "static",
  };

  const allAssets: Asset[] = await db.select().from(assets);
  const candidates = rankCandidates(slot, allAssets);
  const { content } = await generateSlot(slot, kb, candidates);

  const variant =
    content.platforms.find((p) => p.platform === platform) ??
    content.platforms[0];
  if (!variant) {
    throw new Error("Brain returned no copy for regenerate.");
  }

  // Re-resolve the matched asset (workdrive_id -> assets.id) if the brain repicked.
  let assetId = post.assetId;
  if (content.assetMatch.matchedWorkdriveId) {
    const match = allAssets.find(
      (a) => a.workdriveId === content.assetMatch.matchedWorkdriveId,
    );
    assetId = match?.id ?? assetId;
  }
  const matched = allAssets.find((a) => a.id === assetId);

  const rows = await db
    .update(posts)
    .set({
      copy: `${variant.hook}\n\n${variant.copy}`,
      hashtags: variant.hashtags,
      cta: variant.cta,
      format: content.format,
      editBrief: content.assetMatch.renderBrief,
      renderKind: coerceRenderKind(content.assetMatch.renderKind, matched),
      assetId,
      // A regenerated visual is stale — clear it so the render pass redoes it.
      renderUrl: null,
      status: "needs_review",
      updatedAt: raw`now()`,
    })
    .where(eq(posts.id, post.id))
    .returning();

  const updated = rows[0];
  if (!updated) throw new Error(`Post ${post.id} disappeared during regenerate.`);
  return updated;
}
