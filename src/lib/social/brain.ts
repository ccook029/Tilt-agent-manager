import { CLAUDE_MODEL } from "@/lib/models";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { KbConfig } from "@/lib/social/kb/config";
import type { PostSlot } from "@/lib/social/planner/schedule";
import type { RankedAsset } from "@/lib/social/planner/assetMatch";
import { HARD_RULES, checkContentSafety } from "@/lib/social/brand";
import { renderEthos } from "@/lib/ethos";

/**
 * The planning brain (Phase 2, text only). For one locked-window slot it writes
 * platform-specific copy, picks the best catalog asset (or flags a gap), and
 * proposes a render brief — all as validated structured output.
 *
 * Best practices (per the Claude API skill):
 *  - Model: claude-opus-4-8 (override via ANTHROPIC_BRAIN_MODEL).
 *  - Adaptive thinking for the planning reasoning.
 *  - Prompt caching: the brand + KB system prompt is stable and cached; only the
 *    per-slot user message varies.
 *  - Structured outputs via output_config.format (zodOutputFormat) + parse().
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
const BRAIN_MODEL = process.env.ANTHROPIC_BRAIN_MODEL ?? CLAUDE_MODEL;

const PlatformCopy = z.object({
  platform: z.enum(["instagram", "tiktok", "facebook"]),
  hook: z.string(),
  copy: z.string(),
  hashtags: z.array(z.string()),
  cta: z.string(),
});

const PostContentSchema = z.object({
  objective: z.string(),
  format: z.enum(["reel", "static", "carousel"]),
  platforms: z.array(PlatformCopy),
  assetMatch: z.object({
    matchedWorkdriveId: z.string().nullable(),
    renderKind: z.enum(["nano", "shotstack", "manual"]).nullable(),
    renderBrief: z.string(),
  }),
  gap: z.object({
    isGap: z.boolean(),
    neededAsset: z.string(),
  }),
});

export type PostContent = z.infer<typeof PostContentSchema>;

export type GeneratedSlot = {
  slot: PostSlot;
  content: PostContent;
  safety: { safe: boolean; violations: string[] };
};

function buildSystemPrompt(kb: KbConfig): string {
  const products = kb.products
    .map((p) => `- ${p.name} (${p.category})${p.msrp ? ` — MSRP ${p.msrp}` : ""}: ${p.notes}`)
    .join("\n");
  return [
    renderEthos(),
    ``,
    `You are the social content strategist + copywriter for Tilt Hockey.`,
    `Core line: "${kb.voice.coreLine}". Voice: ${kb.voice.traits.join(", ")}.`,
    `Themes: ${kb.voice.themes.join(" / ")}.`,
    ``,
    `NON-NEGOTIABLE RULES:`,
    ...HARD_RULES.map((r) => `- ${r}`),
    `- Never state a price unless an MSRP is explicitly provided below.`,
    `- Avoid: ${kb.voice.avoid.join("; ")}.`,
    ``,
    `Products (public info only):`,
    products,
    ``,
    `Competitors you may contrast against for the "Don't-Be-A-Sheep" pillar (value, never undercutting): ${kb.competitors.join(", ")}.`,
    ``,
    `Write copy that is genuinely platform-specific: Instagram (polished, hook-first, emoji-aware), TikTok (punchy, native, trend-aware, shorter), Facebook (slightly longer, community-oriented). Never reuse identical copy across platforms.`,
    `Use hashtags drawn from these pools where they fit. Core: ${kb.hashtags.core.join(" ")}.`,
  ].join("\n");
}

function buildUserPrompt(slot: PostSlot, candidates: RankedAsset[]): string {
  const cand = candidates.length
    ? candidates
        .map(
          (c) =>
            `- workdriveId="${c.asset.workdriveId}" | ${c.asset.type} | ${c.asset.filename} | ${(c.asset.tags?.description ?? "").trim()} | why: ${c.reason}`,
        )
        .join("\n")
    : "(no candidate assets matched — likely a gap)";

  return [
    `Create the post for this locked-window slot.`,
    `Date: ${slot.date}`,
    `Pillar: ${slot.pillarName} (id ${slot.pillarId})`,
    `Target platforms: ${slot.platforms.join(", ")}`,
    `Suggested format: ${slot.formatHint}`,
    ``,
    `Candidate assets from the REAL tagged library (pick the single best, or declare a gap if none truly fits):`,
    cand,
    ``,
    `Rules for asset selection:`,
    `- If a candidate fits: set assetMatch.matchedWorkdriveId to its workdriveId, set gap.isGap=false, and write a renderBrief.`,
    `  renderKind: "nano" for a static photo treatment, "shotstack" for a simple auto-assembled reel, "manual" for a hero/creative video edit.`,
    `  renderKind must match the asset type: "shotstack"/"manual" only for video candidates, "nano" only for photos. If a reel slot has no video candidate, pick the best photo with renderKind "nano" (a branded vertical static) — or declare a gap if the slot truly needs footage.`,
    `- If nothing fits: set gap.isGap=true and describe the exact shot needed in gap.neededAsset (the founder's next shot), and matchedWorkdriveId=null.`,
    `Write hook + full copy + hashtags + CTA for EACH target platform.`,
  ].join("\n");
}

/** Generates content for a single slot. Throws if ANTHROPIC_API_KEY is unset. */
export async function generateSlot(
  slot: PostSlot,
  kb: KbConfig,
  candidates: RankedAsset[],
): Promise<GeneratedSlot> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — the planning brain needs it.");
  }

  const response = await anthropic.messages.parse({
    model: BRAIN_MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: buildSystemPrompt(kb),
        cache_control: { type: "ephemeral" }, // stable prefix — cached across slots
      },
    ],
    messages: [{ role: "user", content: buildUserPrompt(slot, candidates) }],
    output_config: { format: zodOutputFormat(PostContentSchema) },
  });

  const content = response.parsed_output;
  if (!content) {
    throw new Error(`Brain returned no parseable content for ${slot.date}`);
  }

  // Coarse safety scrub over everything a human/audience will see.
  const blob = content.platforms
    .map((p) => `${p.hook} ${p.copy} ${p.hashtags.join(" ")} ${p.cta}`)
    .join(" ");
  const safety = checkContentSafety(blob);

  return { slot, content, safety };
}
