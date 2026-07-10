import { CLAUDE_MODEL } from "@/lib/models";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { orgStickDeals, type OrgStickDeal, type OrgDealPitch } from "@/lib/social/db/schema";
import { getActiveKbConfig } from "@/lib/social/kb/config";
import { BRAND, HARD_RULES, checkContentSafety } from "@/lib/social/brand";
import { composePartnerGraphic } from "@/lib/social/announce/compose";
import { formatDeadline } from "@/lib/social/fundraiser/generate";
import { mirrorToBlob, readBlobBytes } from "@/lib/social/blob";
import { renderPitchPdf } from "./pitch-pdf";

/**
 * Org stick programs — the full pitch package for one organization, generated
 * from a name + logo + terms + deadline + the org's private tiltweb link:
 *
 *   1. PITCH (org-facing PDF): every term on the table — member discount, org
 *      kickback, deadline, one-batch club delivery — plus the explicit MAP
 *      instruction: the discount may go out by direct email to members, never
 *      on public channels.
 *   2. EMAIL (member-facing): full detail including the discount and link —
 *      email is the one member channel where MAP allows the number.
 *   3. SOCIAL (public): caption + code-composited graphics with ZERO pricing —
 *      no percentages, no dollars, no "discount". The post drives members to
 *      their inbox/club, nothing more. Enforced by scrubMapSafety() below, not
 *      just the prompt.
 *
 * Same stack as announcements: Claude writes every word, compose.ts stamps the
 * org crest + TILT wordmark in code (logos are never AI-drawn).
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
const BRAIN_MODEL = process.env.ANTHROPIC_BRAIN_MODEL ?? CLAUDE_MODEL;

const OrgDealContentSchema = z.object({
  social: z.object({
    copy: z.string(),
    hashtags: z.array(z.string()),
    cta: z.string(),
    /** One sentence typeset on the graphic itself. */
    graphicLine: z.string(),
  }),
  email: z.object({
    subject: z.string(),
    /** Plain text with blank lines between paragraphs — pasteable anywhere. */
    body: z.string(),
  }),
  pitch: z.object({
    headline: z.string(),
    intro: z.string(),
    bullets: z.array(z.object({ title: z.string(), detail: z.string() })),
    mapNote: z.string(),
    closing: z.string(),
  }),
});

export type OrgDealContent = z.infer<typeof OrgDealContentSchema>;

/** Terms the public post may never contain (MAP). Belt over the prompt's suspenders. */
const MAP_FORBIDDEN = /(\d+\s*%|percent\s+off|\$\s*\d|\bdiscount\b|\boff retail\b|\bsale\b|\bkickback\b)/i;

function scrubMapSafety(social: OrgDealContent["social"]): void {
  const publicText = [social.copy, social.graphicLine, social.cta, ...social.hashtags].join(" ");
  const hit = publicText.match(MAP_FORBIDDEN);
  if (hit) {
    throw new Error(
      `MAP scrub: the public post contained pricing language ("${hit[0]}") — hit Regenerate to rewrite it.`,
    );
  }
}

/** Default bulk delivery target: 6 weeks after the order deadline. */
export function defaultDeliveryDate(deadline: string): string {
  const [y, m, d] = deadline.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 42);
  return date.toISOString().slice(0, 10);
}

export type OrgDealTerms = {
  orgName: string;
  discountPct: number;
  kickbackPct: number;
  deadline: string; // YYYY-MM-DD
  deliveryDate?: string | null; // YYYY-MM-DD
  orderUrl?: string | null;
  contactName?: string | null;
  note?: string | null;
};

/** All three pieces (pitch / email / social) in one brain call. */
export async function writeOrgDealContent(terms: OrgDealTerms): Promise<OrgDealContent> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — org programs need the brain.");
  }
  const kb = await getActiveKbConfig();
  const deadlineLong = formatDeadline(terms.deadline);
  const deliveryLong = terms.deliveryDate ? formatDeadline(terms.deliveryDate) : null;
  const link = terms.orderUrl?.trim() || null;

  const ask = [
    `Write the full launch package for an ORGANIZATION STICK PROGRAM between ${BRAND.name} and "${terms.orgName}".`,
    ``,
    `The deal:`,
    `- ${terms.orgName} members get ${terms.discountPct}% off fully custom Tilt sticks, ordered on a private club page${link ? ` (${link})` : ""} with member pricing applied automatically.`,
    `- Ordering closes ${deadlineLong}. Every stick is built in one production batch and delivered TO THE CLUB in a single shipment${deliveryLong ? ` around ${deliveryLong}` : " about 6 weeks after ordering closes"} — no shipping fees. The club hands sticks out to its teams.`,
    `- ${terms.orgName} earns ${terms.kickbackPct}% of net member sales back, paid after the order window closes. Tilt handles payment, production, and delivery — the club just spreads the word.`,
    terms.contactName ? `- The pitch addresses ${terms.contactName}.` : ``,
    terms.note ? `- Founder note to fold in: ${terms.note}` : ``,
    ``,
    `Deliverables:`,
    `1. pitch — the org-facing one-pager: headline (short, punchy), intro (2-3 sentences selling the program to the club), 4-5 bullets as {title, detail} covering member pricing, the club kickback, the ordering window/deadline, one-batch club delivery, and zero admin work for the club. mapNote: 2-3 sentences telling the org that because of Tilt's MAP (minimum advertised price) policy the member discount must NOT be posted publicly — no social posts, no public website — but they're fully encouraged to share it by direct email or team app with their members, and Tilt provides a ready-to-send email plus MAP-safe social graphics. closing: 1-2 sentences with the next step.`,
    `2. email — the member-facing announcement the club forwards to its members: subject line, then a plain-text body (short paragraphs separated by blank lines). It SHOULD include the ${terms.discountPct}% member discount, the ${deadlineLong} deadline, the club delivery, and ${link ? `the link ${link}` : "a [CLUB LINK] placeholder"}. Warm, club-first, no hard sell. Sign off as Tilt Hockey.`,
    `3. social — the PUBLIC post announcing the program. MAP-CRITICAL: absolutely NO discount, NO percentages, NO dollar amounts, NO "sale/deal/discount" wording anywhere (copy, cta, graphicLine, hashtags). Tease the program ("exclusive member stick program", "custom sticks in club colors"), name the ${deadlineLong} deadline, and send members to their email / the club for details. graphicLine: ONE punchy sentence (max 22 words, no emoji, no hashtags, no numbers except the date) typeset on the graphic.`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.parse({
    model: BRAIN_MODEL,
    max_tokens: 3500,
    system: [
      `You are the copywriter for ${BRAND.name}. Core line: "${kb.voice.coreLine}". Voice: ${kb.voice.traits.join(", ")}.`,
      `NON-NEGOTIABLE RULES:`,
      ...HARD_RULES.map((r) => `- ${r}`),
      `- Avoid: ${kb.voice.avoid.join("; ")}.`,
      `The social caption is ONE uniform caption posted identically to Instagram, TikTok, and Facebook — tight (3-5 short sentences), emoji-light, hook first. Use hashtags from this pool where they fit (plus one or two specific to the org): ${kb.hashtags.core.join(" ")}.`,
      `The pitch and email are B2B/community writing, not social copy — clear, warm, zero hype-speak.`,
    ].join("\n"),
    messages: [{ role: "user", content: ask }],
    output_config: { format: zodOutputFormat(OrgDealContentSchema) },
  });

  const content = response.parsed_output;
  if (!content) throw new Error("Brain returned no parseable org program content.");

  const safety = checkContentSafety(
    [
      content.social.copy,
      content.social.cta,
      content.email.subject,
      content.email.body,
      content.pitch.headline,
      content.pitch.intro,
      ...content.pitch.bullets.map((b) => `${b.title} ${b.detail}`),
      content.pitch.mapNote,
      content.pitch.closing,
    ].join(" "),
  );
  if (!safety.safe) {
    throw new Error(`Copy failed the brand safety scrub: ${safety.violations.join("; ")}`);
  }
  scrubMapSafety(content.social);

  return content;
}

/** Fallback on-image line for rows generated before graphic_line existed. */
function fallbackLine(orgName: string, deadline: string): string {
  return `Custom sticks, club colors, delivered together — ${orgName} members order by ${formatDeadline(deadline)}.`;
}

/** The three canvas sizes every org program post ships in. */
const FORMATS = [
  { key: "", w: 1080, h: 1350 }, // 4:5 feed (main imageUrl)
  { key: "-square", w: 1080, h: 1080 }, // 1:1
  { key: "-story", w: 1080, h: 1920 }, // 9:16 story
] as const;

/**
 * Code-composites the MAP-safe social graphics (org crest stamped by code)
 * in all three formats and persists the URLs on the row.
 */
export async function renderOrgDealGraphics(deal: OrgStickDeal): Promise<string> {
  if (!deal.logoUrl) {
    throw new Error("No org logo uploaded — the graphic needs the crest.");
  }
  const source = await readBlobBytes(deal.logoUrl);
  const line = deal.graphicLine?.trim() || fallbackLine(deal.orgName, deal.deadline);
  const stamp = Date.now();

  const urls: string[] = [];
  for (const f of FORMATS) {
    const png = await composePartnerGraphic({
      name: deal.orgName,
      line,
      partnerLogo: source.buf,
      // The private link is only useful to members — leave it off the public
      // graphic. Site stays null; members get the link by email.
      website: null,
      accentColor: deal.accentColor,
      eyebrow: "EXCLUSIVE MEMBER PROGRAM",
      headlineTop: deal.orgName,
      headlineBottom: "STICK PROGRAM",
      pillText: `ORDER BY ${formatDeadline(deal.deadline)}`,
      width: f.w,
      height: f.h,
    });
    urls.push(
      await mirrorToBlob({
        key: `orgdeals/${deal.id}-${stamp}${f.key}.png`,
        buffer: png,
        contentType: "image/png",
      }),
    );
  }
  await db
    .update(orgStickDeals)
    .set({
      imageUrl: urls[0],
      imageUrlSquare: urls[1],
      imageUrlStory: urls[2],
      updatedAt: raw`now()`,
    })
    .where(eq(orgStickDeals.id, deal.id));
  return urls[0];
}

/** Renders the org pitch one-pager PDF and persists its URL on the row. */
export async function renderOrgDealPitch(deal: OrgStickDeal): Promise<string> {
  const pitch = deal.pitch as OrgDealPitch | null;
  if (!pitch) {
    throw new Error("No pitch content on this program yet — hit Regenerate.");
  }
  const logo = deal.logoUrl ? await readBlobBytes(deal.logoUrl) : null;
  const pdf = await renderPitchPdf({ deal, pitch, orgLogo: logo?.buf ?? null });
  const url = await mirrorToBlob({
    key: `orgdeals/${deal.id}-${Date.now()}-pitch.pdf`,
    buffer: pdf,
    contentType: "application/pdf",
  });
  await db
    .update(orgStickDeals)
    .set({ pitchPdfUrl: url, updatedAt: raw`now()` })
    .where(eq(orgStickDeals.id, deal.id));
  return url;
}
