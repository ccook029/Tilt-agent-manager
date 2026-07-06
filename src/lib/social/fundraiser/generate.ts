import { CLAUDE_MODEL } from "@/lib/models";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { fundraisers, type Fundraiser } from "@/lib/social/db/schema";
import { getActiveKbConfig } from "@/lib/social/kb/config";
import { BRAND, HARD_RULES, checkContentSafety } from "@/lib/social/brand";
import { composeFlyer } from "@/lib/social/render/flyer";
import { mirrorToBlob, readBlobBytes } from "@/lib/social/blob";

/**
 * Blanket fundraisers — one-off pre-order posts for teams/orgs that partner with
 * Tilt to sell custom blankets. The founder uploads the finished blanket
 * rendering, gives the org name, a payment email, a pre-order deadline (varies
 * per org) and an optional note; the agent writes the caption and builds the
 * branded 4:5 flyer AROUND the real blanket image.
 *
 * Same stack as announcements: Claude writes the wording/tags, Nano Banana Pro
 * lays out the flyer around the real blanket photo, code stamps the TILT
 * wordmark. Price is fixed — never AI-guessed.
 */

/** Fixed price per blanket — business rule, not user input. */
export const BLANKET_PRICE = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
const BRAIN_MODEL = process.env.ANTHROPIC_BRAIN_MODEL ?? CLAUDE_MODEL;

const FundraiserCopySchema = z.object({
  copy: z.string(),
  hashtags: z.array(z.string()),
  cta: z.string(),
  /** One sentence typeset on the flyer itself. */
  graphicLine: z.string(),
});

/** Friendly long-form date for captions, e.g. "July 31st". */
export function formatDeadline(deadline: string): string {
  // deadline is a YYYY-MM-DD date string — parse as UTC to avoid TZ drift.
  const [y, m, d] = deadline.split("-").map((n) => Number(n));
  if (!y || !m || !d) return deadline;
  const date = new Date(Date.UTC(y, m - 1, d));
  const month = date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const day = date.getUTCDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${month} ${day}${suffix}`;
}

/** One uniform caption (used across all platforms) for the fundraiser post. */
export async function writeFundraiserCopy(
  orgName: string,
  deadline: string,
  paymentEmail?: string | null,
  note?: string | null,
): Promise<z.infer<typeof FundraiserCopySchema>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — fundraisers need the brain.");
  }
  const kb = await getActiveKbConfig();
  const friendlyDeadline = formatDeadline(deadline);

  const ask = [
    `Write the social caption for a BLANKET FUNDRAISER. The organization "${orgName}" has partnered with ${BRAND.name} to offer these awesome custom team blankets.`,
    `Key facts the post MUST land clearly:`,
    `- ${orgName} has teamed up with Tilt Hockey to provide premium custom blankets.`,
    `- These are PRE-ORDERS, taken now until ${friendlyDeadline}.`,
    `- Price is $${BLANKET_PRICE} per blanket.`,
    paymentEmail ? `- Payment / e-transfer goes to: ${paymentEmail}.` : ``,
    note ? `- Work in this note from the org naturally: "${note}".` : ``,
    `Tone: proud, community-first, hype for the team. Make it easy to share and act on. This is a fundraiser, so a light "support the team" angle is good.`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.parse({
    model: BRAIN_MODEL,
    max_tokens: 1500,
    system: [
      `You are the social copywriter for ${BRAND.name}. Core line: "${kb.voice.coreLine}". Voice: ${kb.voice.traits.join(", ")}.`,
      `NON-NEGOTIABLE RULES:`,
      ...HARD_RULES.map((r) => `- ${r}`),
      `- Avoid: ${kb.voice.avoid.join("; ")}.`,
      `This is ONE uniform caption the TEAM posts to Instagram, TikTok, and Facebook — keep it tight (3-6 short sentences), emoji-light, hook first.`,
      `Always include the price ($${BLANKET_PRICE}), the pre-order deadline (${friendlyDeadline}), and${paymentEmail ? ` the payment contact (${paymentEmail}), and` : ``} a clear call to pre-order.`,
      `Use hashtags from this pool where they fit (plus one or two specific to the team/fundraiser): ${kb.hashtags.core.join(" ")}.`,
      `graphicLine: ONE warm, punchy sentence (max 22 words, NO emoji, NO hashtags) typeset on the flyer itself — e.g. "${orgName} has teamed up with Tilt Hockey to bring you these premium custom blankets."`,
    ].join("\n"),
    messages: [{ role: "user", content: ask }],
    output_config: { format: zodOutputFormat(FundraiserCopySchema) },
  });

  const content = response.parsed_output;
  if (!content) throw new Error("Brain returned no parseable fundraiser copy.");

  const safety = checkContentSafety(`${content.copy} ${content.cta}`);
  if (!safety.safe) {
    throw new Error(`Copy failed the brand safety scrub: ${safety.violations.join("; ")}`);
  }
  return content;
}

// ---- Flyer generation (fully code-composited, deterministic layout) ----

/** Fallback on-image line for rows generated before graphic_line existed. */
function fallbackLine(orgName: string): string {
  return `${orgName} has teamed up with Tilt Hockey to bring you these premium custom blankets.`;
}

// The blanket image is a private blob; pull it back through the store token
// rather than fetching a login-gated URL.
async function fetchBytes(ref: string): Promise<{ buf: Buffer; mime: string }> {
  return readBlobBytes(ref);
}

/** Renders the fundraiser flyer and persists the URL on the row. */
export async function renderFundraiser(f: Fundraiser): Promise<string> {
  if (!f.blanketUrl) {
    throw new Error("No blanket image uploaded — the flyer needs it.");
  }
  const source = await fetchBytes(f.blanketUrl);
  const line = f.graphicLine?.trim() || fallbackLine(f.orgName);
  const friendlyDeadline = formatDeadline(f.deadline);
  const email = f.paymentEmail?.trim();

  // Layout is fixed and code-drawn — no image model, so nothing can overlap or
  // get cut off. The blanket is contained whole; price/pre-order/email sit above
  // the wordmark, which is pinned to the bottom.
  const final = await composeFlyer({
    hero: source.buf,
    headlineTop: f.orgName,
    headlineBottom: "FUNDRAISER",
    tagline: line,
    infoPrimary: `$${BLANKET_PRICE} PER BLANKET`,
    infoSecondary: `PRE-ORDER UNTIL ${friendlyDeadline.toUpperCase()}`,
    infoTertiary: email ? `E-TRANSFER: ${email}` : null,
  });

  const url = await mirrorToBlob({
    key: `fundraisers/${f.id}-${Date.now()}.png`,
    buffer: final,
    contentType: "image/png",
  });
  await db
    .update(fundraisers)
    .set({ imageUrl: url, updatedAt: raw`now()` })
    .where(eq(fundraisers.id, f.id));
  return url;
}

