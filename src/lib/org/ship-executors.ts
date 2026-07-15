// ---------------------------------------------------------------------------
// org/ship-executors.ts — what "ship" actually DOES, per department
//
// Chris's approve trigger (shipWorkOrder) calls executeShip. For marketing
// content work orders, the creator's deliverable carries a structured
// ```post fenced block (a different fence tag than ```json so it never
// collides with the decision-request protocol). Shipping parses it and
// inserts Studio `posts` rows with status "approved" — Chris just approved
// them — so they flow into the existing render pipeline and then the
// publish queue. This closes the work-order ↔ Studio seam: /review "ship"
// and /publish are now one pipeline instead of two surfaces.
//
// Departments without an executor ship as a plain status change (the
// deliverable itself — a report, an audit — IS the product).
// ---------------------------------------------------------------------------
import { db } from "../social/db";
import { posts } from "../social/db/schema";
import { hasDatabase } from "../social/env";
import { listAssets } from "../social/queries";
import { getActiveKbConfig } from "../social/kb/config";
import { rankCandidates, coerceRenderKind } from "../social/planner/assetMatch";
import { renderStaticPost } from "../social/render/pipeline";
import type { PostSlot } from "../social/planner/schedule";
import { normalizePlatform } from "../publish/types";
import type { WorkOrder } from "./types";

interface PostPackageItem {
  platform: string;
  pillar?: string;
  format?: string;
  copy: string;
  hashtags: string[];
  cta?: string;
  scheduledDate?: string;
  renderBrief?: string;
}

/** Parse the LAST ```post fenced block from the deliverable. */
export function parsePostPackage(text: string): PostPackageItem[] {
  const matches = [...text.matchAll(/```post\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return [];
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1].trim());
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map((p) => {
        const item = p as Record<string, unknown>;
        return {
          platform: String(item.platform ?? "").trim(),
          pillar: item.pillar ? String(item.pillar) : undefined,
          format: item.format ? String(item.format) : undefined,
          copy: String(item.copy ?? "").trim(),
          hashtags: Array.isArray(item.hashtags)
            ? item.hashtags.map(String)
            : [],
          cta: item.cta ? String(item.cta) : undefined,
          scheduledDate:
            typeof item.scheduled_date === "string"
              ? item.scheduled_date
              : undefined,
          renderBrief: item.render_brief
            ? String(item.render_brief)
            : undefined,
        };
      })
      .filter((p) => p.copy.length > 0 && normalizePlatform(p.platform) !== null);
  } catch {
    return [];
  }
}

/** Match a shipped piece to the best library asset so it can actually render.
 * Reuses the planner's ranking; returns null when nothing in the library fits. */
async function matchAsset(item: PostPackageItem) {
  const [library, kb] = await Promise.all([
    listAssets({ limit: 500 }),
    getActiveKbConfig(),
  ]);
  const pillar = kb.pillars.find((p) => p.key === (item.pillar ?? "product"));
  const slot: PostSlot = {
    date: item.scheduledDate ?? new Date().toISOString().slice(0, 10),
    pillarId: pillar?.id ?? 4,
    pillarKey: pillar?.key ?? "product",
    pillarName: pillar?.name ?? "Product",
    platforms: [],
    formatHint: item.format === "reel" || item.format === "carousel" ? item.format : "static",
  };
  return rankCandidates(slot, library)[0]?.asset ?? null;
}

/** Marketing: shipped content becomes approved Studio posts, asset-matched and
 * (for static images) rendered immediately so they land in /publish with media. */
async function shipMarketingOrder(order: WorkOrder): Promise<string | null> {
  const draft = order.rounds[order.rounds.length - 1]?.draft ?? "";
  const items = parsePostPackage(draft);
  if (items.length === 0) return null; // plans/audits/schedules ship as-is
  if (!hasDatabase()) {
    return "Post package found, but the Studio database isn't configured — content shipped as a document only.";
  }

  let created = 0;
  let rendered = 0;
  let unmatched = 0;
  for (const item of items) {
    const asset = await matchAsset(item).catch(() => null);
    const renderKind = asset
      ? coerceRenderKind(item.format === "reel" ? "shotstack" : "nano", asset)
      : null;

    const inserted = await db
      .insert(posts)
      .values({
        scheduledDate: item.scheduledDate ?? null,
        platform: normalizePlatform(item.platform)!,
        pillar: item.pillar ?? "product",
        format: item.format ?? null,
        copy: item.copy,
        hashtags: item.hashtags,
        cta: item.cta ?? null,
        // Chris's ship IS the approval — straight to the approved queue.
        status: "approved",
        assetId: asset?.id ?? null,
        renderKind,
        editBrief: item.renderBrief ?? null,
      })
      .returning();
    created += 1;
    if (!asset) unmatched += 1;

    // Best-effort immediate render for static images (nano). Reels render via
    // the Studio's Shotstack pass — submit/poll is too slow to inline here.
    const post = inserted[0];
    if (post && renderKind === "nano") {
      const result = await renderStaticPost(post).catch(() => null);
      if (result?.renderUrl) rendered += 1;
    }
  }

  const parts = [
    `${created} approved Studio post${created === 1 ? "" : "s"} created`,
  ];
  if (rendered > 0) parts.push(`${rendered} rendered and ready in /publish`);
  if (unmatched > 0)
    parts.push(
      `${unmatched} need${unmatched === 1 ? "s" : ""} footage the library lacks — match or upload in the Studio`
    );
  if (created - rendered - unmatched > 0)
    parts.push("video pieces render on the Studio's next reel pass");
  return `${parts.join("; ")}.`;
}

/**
 * Run the department's ship executor. Returns a human-readable note about
 * what shipping did, or null when shipping is just the status change.
 * Executors must never throw — a failed side effect shouldn't undo the ship.
 */
export async function executeShip(order: WorkOrder): Promise<string | null> {
  try {
    if (order.departmentId === "marketing") {
      return await shipMarketingOrder(order);
    }
    return null;
  } catch (err) {
    console.error(`[ship-executor] ${order.id} side effect failed:`, err);
    return `Ship recorded, but the follow-on automation failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}
