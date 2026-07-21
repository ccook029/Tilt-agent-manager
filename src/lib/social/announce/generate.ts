import { CLAUDE_MODEL } from "@/lib/models";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { announcements, type Announcement } from "@/lib/social/db/schema";
import { getActiveKbConfig } from "@/lib/social/kb/config";
import { BRAND, HARD_RULES, checkContentSafety } from "@/lib/social/brand";
import { nanoEdit } from "@/lib/social/render/nano";
import { mirrorToBlob, readBlobBytes } from "@/lib/social/blob";
import { composePartnerGraphic, composeAmbassadorGraphic } from "./compose";

/**
 * Announcements — uniform one-off posts outside the content plan:
 *  - "partner":    "WE'RE TEAMING UP WITH {NAME}" graphic + copy. Input: the
 *                  partner's name and logo PNG. The ENTIRE graphic is built in
 *                  code (compose.ts) — deterministic, instant, no image-model
 *                  credits — in 4:5, 1:1, and 9:16.
 *  - "ambassador": "WELCOME TO THE TEAM" graphic + copy. Input: the player's
 *                  name, team, and a REAL photo. The layout is built ENTIRELY
 *                  in code (compose.ts) — deterministic colors and typography,
 *                  the real photo untouched — after the image model got caught
 *                  drifting brand colors, inventing TILT wordmarks, and once
 *                  fabricating a different player. The model's only remaining
 *                  job is a narrow competitor-logo blur on the photo, verified
 *                  by Claude vision and discarded if the player changed.
 *
 * Claude writes the wording/tags for both; code stamps every logo — logos are
 * never AI-drawn.
 */

export type AnnouncementKind = "partner" | "ambassador";

const W = 1080;
const H = 1350; // 4:5, feed-friendly — same as static posts

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
const BRAIN_MODEL = process.env.ANTHROPIC_BRAIN_MODEL ?? CLAUDE_MODEL;

const AnnouncementCopySchema = z.object({
  copy: z.string(),
  hashtags: z.array(z.string()),
  cta: z.string(),
  /** One sentence typeset on the graphic itself. */
  graphicLine: z.string(),
});

/** One uniform caption (used across all platforms) for the announcement. */
export async function writeAnnouncementCopy(
  kind: AnnouncementKind,
  name: string,
  subtitle?: string | null,
  website?: string | null,
): Promise<z.infer<typeof AnnouncementCopySchema>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — announcements need the brain.");
  }
  const kb = await getActiveKbConfig();

  const ask =
    kind === "partner"
      ? [
          `Write the caption for a PARTNERSHIP announcement: ${BRAND.name} is teaming up with "${name}"${subtitle ? ` (${subtitle})` : ""}.`,
          `Tone: thrilled but confident — they chose Tilt because the gear performs. Mention that ${name} will be rocking Tilt Hockey products and that we're proud to support their journey on and off the ice.`,
          website?.trim()
            ? `The partner's website is ${website.trim()} — work it into the caption or CTA naturally (e.g. "check them out at …"), don't force it.`
            : ``,
        ].filter(Boolean)
      : [
          `Write the caption for an AMBASSADOR welcome: "${name}"${subtitle ? ` of ${subtitle}` : ""} is officially joining the TILT AMBASSADOR CLUB — the squad for young hockey stars and future legends.`,
          `Tone: proud, welcoming, player-first. Celebrate the player, not the brand.`,
        ];

  const response = await anthropic.messages.parse({
    model: BRAIN_MODEL,
    max_tokens: 1500,
    system: [
      `You are the social copywriter for ${BRAND.name}. Core line: "${kb.voice.coreLine}". Voice: ${kb.voice.traits.join(", ")}.`,
      `NON-NEGOTIABLE RULES:`,
      ...HARD_RULES.map((r) => `- ${r}`),
      `- Avoid: ${kb.voice.avoid.join("; ")}.`,
      `This is ONE uniform caption posted identically to Instagram, TikTok, and Facebook — keep it tight (3-5 short sentences), emoji-light, hook first.`,
      `Use hashtags from this pool where they fit (plus one or two specific to the announcement): ${kb.hashtags.core.join(" ")}.`,
      `graphicLine: ONE warm, punchy sentence (max 25 words, NO emoji, NO hashtags) that will be typeset on the announcement graphic itself — e.g. "Flex Hockey will now be rocking Tilt Hockey products, and we couldn't be more excited to support their journey on and off the ice."`,
    ].join("\n"),
    messages: [{ role: "user", content: ask.join("\n") }],
    output_config: { format: zodOutputFormat(AnnouncementCopySchema) },
  });

  const content = response.parsed_output;
  if (!content) throw new Error("Brain returned no parseable announcement copy.");

  const safety = checkContentSafety(`${content.copy} ${content.cta}`);
  if (!safety.safe) {
    throw new Error(`Copy failed the brand safety scrub: ${safety.violations.join("; ")}`);
  }
  return content;
}

// ---- Graphic generation ----

/** Fallback on-image line for rows generated before graphic_line existed. */
function fallbackLine(kind: AnnouncementKind, name: string): string {
  return kind === "partner"
    ? `${name} will now be rocking Tilt Hockey products — and we're proud to back their journey on and off the ice.`
    : `Built for players who'd rather lead than follow. Welcome to the squad, ${name}.`;
}

// ---- Competitor-logo blur (the image model's ONLY remaining job) ----

const SamePlayerSchema = z.object({
  samePerson: z.boolean(),
  reason: z.string(),
});

/**
 * Claude vision check: is the edited photo the SAME photograph of the SAME
 * person, just with logo blurs? Fail-closed: any doubt or API error means the
 * edit is discarded and the untouched original is used instead.
 */
async function verifySamePlayer(original: Buffer, edited: Buffer): Promise<boolean> {
  try {
    const shrink = (b: Buffer) =>
      sharp(b).resize({ width: 512, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const [a, b] = await Promise.all([shrink(original), shrink(edited)]);
    const response = await anthropic.messages.parse({
      model: BRAIN_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Image 1 is an original photo of a hockey player. Image 2 is a retouched copy that should be IDENTICAL apart from small blur patches over equipment brand logos.",
            },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: a.toString("base64") } },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") } },
            {
              type: "text",
              text: "Is image 2 the same photograph of the same real person — same face, same pose, same jersey — with at most minor logo blurring? Answer samePerson=false if the person was replaced, redrawn, restyled, or the photo looks regenerated rather than retouched.",
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(SamePlayerSchema) },
    });
    return response.parsed_output?.samePerson ?? false;
  } catch {
    return false;
  }
}

/**
 * Blur competitor equipment logos (CCM, Bauer, Warrior, True…) on the player
 * photo. Narrow retouch brief + Claude-vision identity verification; if the
 * model changed ANYTHING about the player or the check can't pass, the
 * original photo is returned untouched. Never throws.
 */
async function blurCompetitorMarks(source: {
  buf: Buffer;
  mime: string;
}): Promise<{ buf: Buffer; mime: string }> {
  if (!process.env.GEMINI_API_KEY) return { buf: source.buf, mime: source.mime };
  try {
    const edited = await nanoEdit({
      sourceImage: source.buf,
      sourceMimeType: source.mime,
      brief: {
        brief: [
          `PHOTO RETOUCH ONLY — output this exact photograph, pixel-identical, except for ONE change:`,
          `apply a small localized blur over any visible equipment manufacturer logos or wordmarks (stick, gloves, helmet, pants — e.g. CCM, Bauer, Warrior, True, Sherwood).`,
          `Do NOT change the player, face, pose, body, team jersey, crest, numbers, colors, lighting, background, or crop. Same person, same photograph — only the blur patches differ.`,
          `If there are no competitor logos visible, return the photo unchanged.`,
        ].join("\n"),
      },
    });
    const ok = await verifySamePlayer(source.buf, edited.image);
    if (!ok) {
      console.warn(
        "[announce] competitor-logo blur rejected by identity check — using the original photo.",
      );
      return { buf: source.buf, mime: source.mime };
    }
    return { buf: edited.image, mime: edited.mimeType };
  } catch (err) {
    console.warn(
      `[announce] competitor-logo blur skipped (${err instanceof Error ? err.message : String(err)}) — using the original photo.`,
    );
    return { buf: source.buf, mime: source.mime };
  }
}


// Source is a private blob (the uploaded logo/photo); pull it back through the
// store token, not an HTTP fetch of a login-gated URL.
async function fetchBytes(ref: string): Promise<{ buf: Buffer; mime: string }> {
  return readBlobBytes(ref);
}

/** The three canvas sizes every partner announcement ships in. */
const PARTNER_FORMATS = [
  { key: "", w: 1080, h: 1350 }, // 4:5 feed (main imageUrl)
  { key: "-square", w: 1080, h: 1080 }, // 1:1
  { key: "-story", w: 1080, h: 1920 }, // 9:16 story
] as const;

/**
 * Renders the announcement graphic(s) and persists the URL(s) on the row.
 *
 * Partner: fully code-composited (no image model, no credits, instant) in all
 * three formats. Ambassador: also fully code-composited (4:5) around the real
 * photo — the image model only gets one narrow, identity-verified job first:
 * blurring competitor logos on the photo.
 */
export async function renderAnnouncement(a: Announcement): Promise<string> {
  if (!a.sourceUrl) {
    throw new Error(
      a.kind === "partner"
        ? "No partner logo uploaded — the badge needs it."
        : "No player photo uploaded — real assets only.",
    );
  }
  const source = await fetchBytes(a.sourceUrl);
  const line = a.graphicLine?.trim() || fallbackLine(a.kind as AnnouncementKind, a.name);
  const stamp = Date.now();

  if (a.kind === "partner") {
    const layout = {
      logoPosition: (a.logoPosition ?? "center") as "left" | "center" | "right",
      logoScale: (a.logoScale ?? "md") as "sm" | "md" | "lg",
      lockup: a.lockup ?? false,
    };
    const urls: string[] = [];
    for (const f of PARTNER_FORMATS) {
      const png = await composePartnerGraphic({
        name: a.name,
        line,
        partnerLogo: source.buf,
        website: a.website,
        accentColor: a.accentColor,
        layout,
        width: f.w,
        height: f.h,
      });
      urls.push(
        await mirrorToBlob({
          key: `announcements/${a.id}-${stamp}${f.key}.png`,
          buffer: png,
          contentType: "image/png",
        }),
      );
    }
    await db
      .update(announcements)
      .set({
        imageUrl: urls[0],
        imageUrlSquare: urls[1],
        imageUrlStory: urls[2],
        updatedAt: raw`now()`,
      })
      .where(eq(announcements.id, a.id));
    return urls[0];
  }

  // Ambassador: blur competitor logos on the photo (identity-verified, falls
  // back to the untouched original), then build the entire layout in code.
  const photo = await blurCompetitorMarks(source);
  const final = await composeAmbassadorGraphic({
    name: a.name,
    subtitle: a.subtitle,
    photo: photo.buf,
    width: W,
    height: H,
  });

  const url = await mirrorToBlob({
    key: `announcements/${a.id}-${stamp}.png`,
    buffer: final,
    contentType: "image/png",
  });
  await db
    .update(announcements)
    .set({ imageUrl: url, updatedAt: raw`now()` })
    .where(eq(announcements.id, a.id));
  return url;
}
