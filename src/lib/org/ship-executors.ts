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

/** Marketing: shipped content becomes approved Studio posts. */
async function shipMarketingOrder(order: WorkOrder): Promise<string | null> {
  const draft = order.rounds[order.rounds.length - 1]?.draft ?? "";
  const items = parsePostPackage(draft);
  if (items.length === 0) return null; // plans/audits/schedules ship as-is
  if (!hasDatabase()) {
    return "Post package found, but the Studio database isn't configured — content shipped as a document only.";
  }

  let created = 0;
  for (const item of items) {
    await db.insert(posts).values({
      scheduledDate: item.scheduledDate ?? null,
      platform: normalizePlatform(item.platform)!,
      pillar: item.pillar ?? "product",
      format: item.format ?? null,
      copy: item.copy,
      hashtags: item.hashtags,
      cta: item.cta ?? null,
      // Chris's ship IS the approval — straight to the approved queue.
      // It becomes publishable once the render pipeline attaches media.
      status: "approved",
      editBrief: item.renderBrief ?? null,
    });
    created += 1;
  }
  return `${created} approved Studio post${created === 1 ? "" : "s"} created — they appear in /publish once rendered.`;
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
