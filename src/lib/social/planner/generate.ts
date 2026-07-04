import { sql as raw, eq } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { planSkeleton, posts, gaps, assets, type Asset } from "@/lib/social/db/schema";
import { getActiveKbConfig } from "@/lib/social/kb/config";
import { buildSkeleton, buildLockedSlots } from "./schedule";
import { rankCandidates, coerceRenderKind } from "./assetMatch";
import { generateSlot } from "@/lib/social/brain";
import { postSignal } from "@/lib/signals";

/**
 * Phase 2 orchestrator: regenerate the living 6-month skeleton, then resolve the
 * locked 14-day window into finished posts (per-platform copy) + gap flags.
 *
 * Skeleton generation is deterministic (no AI). Locked-window copy uses the
 * brain (one call per slot, brand/KB prompt cached).
 */

export type PlanSummary = {
  skeletonWeeks: number;
  slots: number;
  postsWritten: number;
  gapsFlagged: number;
  errors: { date: string; error: string }[];
};

export async function generatePlan(opts?: {
  weeks?: number;
  lockedDays?: number;
  onProgress?: (m: string) => void;
}): Promise<PlanSummary> {
  const log = opts?.onProgress ?? (() => {});
  const weeks = opts?.weeks ?? 26;
  const lockedDays = opts?.lockedDays ?? 14;
  const kb = await getActiveKbConfig();
  const now = new Date();

  // 1) Skeleton (deterministic) — upsert each week.
  log("Building 6-month skeleton…");
  const skeleton = buildSkeleton(now, weeks, kb);
  for (const wk of skeleton) {
    await db
      .insert(planSkeleton)
      .values({
        weekStart: wk.weekStart,
        pillarAllocations: wk.pillarAllocations,
        pinnedEvents: wk.pinnedEvents,
      })
      .onConflictDoUpdate({
        target: planSkeleton.weekStart,
        set: {
          pillarAllocations: wk.pillarAllocations,
          pinnedEvents: wk.pinnedEvents,
          updatedAt: raw`now()`,
        },
      });
  }

  // 2) Locked window — write finished posts + gaps.
  const slots = buildLockedSlots(now, lockedDays, kb);
  log(`Resolving ${slots.length} locked-window slots…`);

  const allAssets: Asset[] = await db.select().from(assets);

  const summary: PlanSummary = {
    skeletonWeeks: skeleton.length,
    slots: slots.length,
    postsWritten: 0,
    gapsFlagged: 0,
    errors: [],
  };

  for (const slot of slots) {
    try {
      const candidates = rankCandidates(slot, allAssets);
      log(`  ✎ ${slot.date} · ${slot.pillarName}…`);
      const { content } = await generateSlot(slot, kb, candidates);

      // Resolve matched asset (workdrive_id -> assets.id).
      let matched: Asset | undefined;
      if (content.assetMatch.matchedWorkdriveId) {
        matched = allAssets.find(
          (a) => a.workdriveId === content.assetMatch.matchedWorkdriveId,
        );
      }
      const assetId = matched?.id ?? null;
      const renderKind = coerceRenderKind(content.assetMatch.renderKind, matched);

      // One post row per platform variant (matches the posts schema).
      for (const variant of content.platforms) {
        await db.insert(posts).values({
          scheduledDate: slot.date,
          platform: variant.platform,
          pillar: slot.pillarName,
          format: content.format,
          copy: `${variant.hook}\n\n${variant.copy}`,
          hashtags: variant.hashtags,
          cta: variant.cta,
          status: "needs_review",
          assetId,
          renderKind,
          editBrief: content.assetMatch.renderBrief,
        });
        summary.postsWritten++;
      }

      // Gap flag for the founder's shot list.
      if (content.gap.isGap) {
        await db.insert(gaps).values({
          weekStart: weekStartOf(slot.date),
          neededAssetDescription: content.gap.neededAsset,
          status: "open",
        });
        summary.gapsFlagged++;
      }
    } catch (err) {
      summary.errors.push({
        date: slot.date,
        error: err instanceof Error ? err.message : String(err),
      });
      log(`  ! ${slot.date}: ${err}`);
    }
  }

  // Fire-and-forget: a missing KV store must never fail a plan run.
  await postSignal({
    source: "social-studio",
    headline: `Content plan regenerated: ${summary.postsWritten} posts drafted for the next ${lockedDays} days, ${summary.gapsFlagged} asset gaps flagged`,
    detail: summary.errors.length
      ? `${summary.errors.length} slot(s) failed to generate`
      : undefined,
  }).catch(() => {});

  return summary;
}

function weekStartOf(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** Clears generated posts/gaps so a regenerate doesn't pile up duplicates. */
export async function clearGeneratedPlan(): Promise<void> {
  await db.delete(posts).where(eq(posts.status, "needs_review"));
  await db.delete(gaps).where(eq(gaps.status, "open"));
}
