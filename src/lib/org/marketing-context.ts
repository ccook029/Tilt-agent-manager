// ---------------------------------------------------------------------------
// org/marketing-context.ts — the shared brain for the Marketing department
//
// Every marketing employee (and their boss Harper) drafts and reviews against
// the SAME grounding: Tilt's brand voice + guardrails, the live content plan
// and its gaps, what's actually in the asset library, what competitors are
// doing on social, and how the website is performing. This is the marketing
// analogue of org-knowledge.ts — assembled fresh each run.
//
// Everything here degrades gracefully: the Social Studio queries fall back to
// demo/default data when the Postgres DB isn't configured (isDemoMode), and
// GA4 is wrapped so a missing integration never breaks a work order.
// ---------------------------------------------------------------------------
import { getActiveKbConfig } from "../social/kb/config";
import { HARD_RULES } from "../social/brand";
import { getCatalogStats, getSkeleton, listGaps } from "../social/queries";
import { getRecentSignals } from "../signals";
import { fetchGA4Data, getWeekRange } from "../ga4";

function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  return p.catch(() => fallback);
}

/** Brand voice + the non-negotiable guardrails, from the versioned KB. */
async function renderBrandBlock(): Promise<string> {
  const kb = await getActiveKbConfig().catch(() => null);
  if (!kb) return "";
  const lines = [
    "=== TILT BRAND BAR (authoritative — every piece must clear this) ===",
    `Core line: ${kb.voice.coreLine}`,
    `Voice: ${kb.voice.traits.join(", ")}`,
    `Themes to hit: ${kb.voice.themes.join(", ")}`,
    `NEVER: ${kb.voice.avoid.join("; ")}`,
    "",
    "HARD RULES (a piece that breaks any of these fails review automatically):",
    ...HARD_RULES.map((r) => `- ${r}`),
    "",
    `Content pillars: ${kb.pillars
      .map((p) => `${p.name} (${p.key}, weight ${p.weight})`)
      .join(" · ")}`,
    `Weekly cadence: IG ${kb.cadence.instagramPerWeek} · TikTok ${kb.cadence.tiktokPerWeek} · Facebook ${kb.cadence.facebookPerWeek}. Priority format: ${kb.cadence.priorityFormat}.`,
    `Products: ${kb.products.map((p) => p.name).join(", ")}`,
    `Core hashtags: ${kb.hashtags.core.join(" ")}`,
    `Approved CTAs: ${kb.ctas.join(" | ")}`,
    kb.calendar.length > 0
      ? `Calendar moments: ${kb.calendar
          .map((c) => `${c.label} (${c.date})`)
          .join(" · ")}`
      : "",
    "=== END BRAND BAR ===",
  ].filter(Boolean);
  return lines.join("\n");
}

/** The living plan: upcoming weeks + the shot-list gaps the founder must fill. */
async function renderPlanBlock(): Promise<string> {
  const skeleton = await safe(getSkeleton(6), null as Awaited<
    ReturnType<typeof getSkeleton>
  > | null);
  const gaps = await safe(listGaps(), []);
  const parts: string[] = ["=== CONTENT PLAN (next weeks) ==="];

  if (skeleton && skeleton.weeks.length > 0) {
    for (const w of skeleton.weeks.slice(0, 6)) {
      const pillars = Object.entries(w.pillarAllocations)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}×${n}`)
        .join(", ");
      const events =
        w.pinnedEvents.length > 0
          ? ` — pinned: ${w.pinnedEvents.map((e) => e.label).join(", ")}`
          : "";
      parts.push(`- Week of ${w.weekStart}: ${pillars || "(open)"}${events}`);
    }
  } else {
    parts.push("(no plan skeleton yet — plan from the cadence + calendar above)");
  }

  const openGaps = gaps.filter((g) => g.status === "open");
  if (openGaps.length > 0) {
    parts.push(
      "",
      "OPEN SHOT-LIST GAPS (the library lacks these — flag when a piece needs one):",
      ...openGaps
        .slice(0, 12)
        .map((g) => `- [${g.weekStart}] ${g.neededAssetDescription}`)
    );
  }
  parts.push("=== END CONTENT PLAN ===");
  return parts.join("\n");
}

/** What's actually available to post with. */
async function renderLibraryBlock(): Promise<string> {
  const stats = await safe(getCatalogStats(), {
    total: 0,
    photos: 0,
    videos: 0,
    tagged: 0,
    untagged: 0,
  });
  return [
    "=== ASSET LIBRARY ===",
    `${stats.total} assets (${stats.photos} photos, ${stats.videos} videos; ${stats.tagged} tagged, ${stats.untagged} untagged).`,
    stats.total === 0
      ? "Library is empty/unavailable — brief the shot you need as a gap rather than assuming footage exists."
      : "Only brief renders against assets that plausibly exist; otherwise file a gap.",
    "=== END ASSET LIBRARY ===",
  ].join("\n");
}

/** Recent competitor-social intel (Sloane) + other cross-team signals. */
async function renderIntelBlock(): Promise<string> {
  const signals = await safe(getRecentSignals(24 * 7), []);
  const relevant = signals
    .filter((s) => s.source === "marketing" || s.source === "competitor-social")
    .slice(0, 8);
  if (relevant.length === 0) return "";
  return [
    "=== RECENT MARKETING INTEL (last 7 days) ===",
    ...relevant.map(
      (s) => `- [${s.source}] ${s.headline}${s.detail ? ` — ${s.detail}` : ""}`
    ),
    "=== END MARKETING INTEL ===",
  ].join("\n");
}

/** Website performance snapshot (SEO/analytics grounding). Best-effort. */
async function renderAnalyticsBlock(): Promise<string> {
  try {
    const data = await fetchGA4Data(getWeekRange(new Date()));
    return [
      "=== TILTHOCKEY.COM — LAST 7 DAYS (GA4) ===",
      data.slice(0, 4000),
      "=== END GA4 ===",
    ].join("\n");
  } catch {
    return "=== TILTHOCKEY.COM ANALYTICS ===\n(GA4 not available this run — reason from the brand/plan context instead.)\n=== END ===";
  }
}

/**
 * The full marketing grounding block appended to marketing employees' prompts.
 * `includeAnalytics` is on for the SEO specialist and the director (who plan
 * around performance) and off for the pure-creative roles to save tokens.
 */
export async function renderMarketingContext(
  opts: { includeAnalytics?: boolean } = {}
): Promise<string> {
  const blocks = await Promise.all([
    renderBrandBlock(),
    renderPlanBlock(),
    renderLibraryBlock(),
    renderIntelBlock(),
    opts.includeAnalytics ? renderAnalyticsBlock() : Promise.resolve(""),
  ]);
  const body = blocks.filter((b) => b.trim()).join("\n\n");
  return body ? `\n\n${body}` : "";
}
