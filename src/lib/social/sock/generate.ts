import { CLAUDE_MODEL } from "@/lib/models";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { sockDesigns, type SockDesign } from "@/lib/social/db/schema";
import { getActiveKbConfig } from "@/lib/social/kb/config";
import { BRAND, HARD_RULES, checkContentSafety } from "@/lib/social/brand";
import { nanoCall } from "@/lib/social/render/nano";
import { composeFlyer } from "@/lib/social/render/flyer";
import { mirrorToBlob } from "@/lib/social/blob";

/**
 * Custom dress socks — a B2B design + pitch tool. Tilt wants to design dress
 * socks for each organization in their team colors/logo and sell them to the org.
 *
 * Two outputs per row:
 *  1) designUrl — an UNBRANDED dress sock product mockup in the org's colors,
 *     carrying the org's logo (this is the org's product, so no Tilt mark on it).
 *  2) flyerUrl  — a Tilt-branded sales flyer built AROUND the sock mockup that
 *     the founder shows the org to pitch the concept.
 *
 * This is a product-DESIGN tool (like the blanket render itself), distinct from
 * the social-content pipeline: there is no real photo of a sock that doesn't
 * exist yet, so the mockup is generated. The TILT wordmark on the pitch flyer is
 * still composited by code, never AI-drawn.
 */

const W = 1080;
const H = 1350; // 4:5, feed-friendly

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
const BRAIN_MODEL = process.env.ANTHROPIC_BRAIN_MODEL ?? CLAUDE_MODEL;

const SockPitchSchema = z.object({
  copy: z.string(),
  hashtags: z.array(z.string()),
  cta: z.string(),
  /** One sentence typeset on the pitch flyer itself. */
  graphicLine: z.string(),
});

/** Short B2B pitch copy Tilt uses when presenting the sock concept to the org. */
export async function writeSockPitch(
  orgName: string,
  colors?: string | null,
  note?: string | null,
): Promise<z.infer<typeof SockPitchSchema>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — sock pitches need the brain.");
  }
  const kb = await getActiveKbConfig();

  const ask = [
    `Write a short, punchy PITCH for ${BRAND.name} selling CUSTOM DRESS SOCKS to the organization "${orgName}".`,
    `These are premium custom dress socks designed in the team's colors${colors ? ` (${colors})` : ""} and carrying the team logo — perfect for game days, banquets, coaches, and team store sales.`,
    note ? `Work in this direction from us naturally: "${note}".` : ``,
    `Angle: this is Tilt approaching the org with a sharp concept — make them want to say yes. Lean on team pride, a clean professional look, and that Tilt handles design + production.`,
    `Keep it tight (3-5 short sentences). This is shown to the org's decision-makers, not posted publicly — so it reads like a confident pitch, not a consumer ad.`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.parse({
    model: BRAIN_MODEL,
    max_tokens: 1500,
    system: [
      `You are the brand copywriter for ${BRAND.name}. Core line: "${kb.voice.coreLine}". Voice: ${kb.voice.traits.join(", ")}.`,
      `NON-NEGOTIABLE RULES:`,
      ...HARD_RULES.map((r) => `- ${r}`),
      `- Avoid: ${kb.voice.avoid.join("; ")}.`,
      `This is a B2B PITCH, not a social post — keep hashtags minimal (0-2, only if genuinely useful) and skip emoji.`,
      `cta: one clear next step for the org (e.g. "Reply to lock in your team's colors and we'll send proofs.").`,
      `graphicLine: ONE confident sentence (max 20 words, NO emoji, NO hashtags) typeset on the pitch flyer — e.g. "Custom dress socks for ${orgName}, designed in your colors and built to rep the crest."`,
    ].join("\n"),
    messages: [{ role: "user", content: ask }],
    output_config: { format: zodOutputFormat(SockPitchSchema) },
  });

  const content = response.parsed_output;
  if (!content) throw new Error("Brain returned no parseable sock pitch.");

  const safety = checkContentSafety(`${content.copy} ${content.cta}`);
  if (!safety.safe) {
    throw new Error(`Copy failed the brand safety scrub: ${safety.violations.join("; ")}`);
  }
  return content;
}

// ---- Sock design mockup ----

function designPrompt(
  orgName: string,
  colors?: string | null,
  note?: string | null,
  revisionNote?: string | null,
): string {
  return [
    `Design a realistic product MOCKUP of a matching PAIR of men's DRESS SOCKS for the hockey organization "${orgName}".`,
    revisionNote?.trim()
      ? `TOP PRIORITY — apply this revision feedback, it overrides conflicting defaults below: "${revisionNote.trim()}"`
      : ``,
    `Use the provided logo image as the team crest/logo: feature it cleanly knitted/printed on the upper leg or cuff of the socks. Reproduce the logo faithfully — same shapes and colors.`,
    colors ? `Team colors to build the sock from: ${colors}. Use these for the body, heel, toe, and striping.` : `Use a tasteful two-tone team color scheme.`,
    `Style: premium athletic-heritage dress socks — clean ribbed knit texture, crisp horizontal stripe accents near the cuff, tasteful and sellable. Show the pair laid flat (or one flat + one slightly angled) on a clean, soft neutral studio background with a subtle shadow. Photorealistic knit detail.`,
    note ? `Extra direction: ${note}.` : ``,
    `STRICT RULES: produce ONLY the socks as a product mockup. Do NOT add any other brand marks, wordmarks, mascots, people, or text beyond the team logo on the sock. Do NOT add a Tilt logo. Center the socks with clean margin all around.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Fallback on-image line for rows generated before graphic_line existed. */
function fallbackLine(orgName: string): string {
  return `Custom dress socks for ${orgName}, designed in your colors and built to rep the crest.`;
}

async function fetchBytes(url: string): Promise<{ buf: Buffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch image failed: ${res.status}`);
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    mime: res.headers.get("content-type") ?? "image/png",
  };
}

/** Renders the sock product mockup (unbranded) and persists designUrl. */
export async function renderSockDesign(s: SockDesign): Promise<string> {
  if (!s.logoUrl) {
    throw new Error("No org logo uploaded — the sock design needs it.");
  }
  const logo = await fetchBytes(s.logoUrl);

  const design = await nanoCall({
    prompt: designPrompt(s.orgName, s.colors, s.note, s.revisionNote),
    sourceImage: logo.buf,
    sourceMimeType: logo.mime,
  });

  // Fit to the canvas; no Tilt branding — this is the org's product.
  const fitted = await sharp(design.image).resize(W, H, { fit: "cover" }).png().toBuffer();

  const url = await mirrorToBlob({
    key: `socks/design/${s.id}-${Date.now()}.png`,
    buffer: fitted,
    contentType: "image/png",
  });
  await db
    .update(sockDesigns)
    .set({ designUrl: url, updatedAt: raw`now()` })
    .where(eq(sockDesigns.id, s.id));
  return url;
}

/** Builds the Tilt-branded pitch flyer around the sock mockup and persists flyerUrl. */
export async function renderSockFlyer(s: SockDesign): Promise<string> {
  if (!s.designUrl) {
    throw new Error("No sock design yet — generate the mockup before the flyer.");
  }
  const design = await fetchBytes(s.designUrl);
  const line = s.graphicLine?.trim() || fallbackLine(s.orgName);

  // Fully code-composited, deterministic layout — same engine as the fundraiser
  // flyer, so nothing overlaps or gets cut off. The sock mockup is the hero.
  const branded = await composeFlyer({
    hero: design.buf,
    headlineTop: s.orgName,
    headlineBottom: "DRESS SOCKS",
    tagline: line,
    infoPrimary: "YOUR COLORS · YOUR CREST",
    infoSecondary: "DESIGN + PRODUCTION BY TILT",
    infoTertiary: null,
  });

  const url = await mirrorToBlob({
    key: `socks/flyer/${s.id}-${Date.now()}.png`,
    buffer: branded,
    contentType: "image/png",
  });
  await db
    .update(sockDesigns)
    .set({ flyerUrl: url, updatedAt: raw`now()` })
    .where(eq(sockDesigns.id, s.id));
  return url;
}
