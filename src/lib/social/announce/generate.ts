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
import { loadLogo, loadShield } from "@/lib/social/render/overlay";
import { mirrorToBlob, readBlobBytes } from "@/lib/social/blob";
import { composePartnerGraphic } from "./compose";

/**
 * Announcements — uniform one-off posts outside the content plan:
 *  - "partner":    "WE'RE TEAMING UP WITH {NAME}" graphic + copy. Input: the
 *                  partner's name and logo PNG. The ENTIRE graphic is built in
 *                  code (compose.ts) — deterministic, instant, no image-model
 *                  credits — in 4:5, 1:1, and 9:16.
 *  - "ambassador": "WELCOME TO THE TEAM" graphic + copy. Input: the player's
 *                  name, team, and a REAL photo (the model builds the layout
 *                  around it — real assets only, same as the rest of the app).
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

const STYLE = [
  `Style: premium sports-brand announcement graphic. Deep black/dark-navy background with a subtle dark checkered texture, electric cyan (${BRAND.colors.cyan}) accent color, bold condensed uppercase typography (Barlow Condensed feel), brushed-silver metallic ribbon accents across the top-left and bottom-right corners.`,
  `Portrait 4:5 canvas.`,
  `STRICT RULES: this is pure graphic DESIGN — do NOT generate any people, players, hockey products, scenes, logos, crests, brand marks, signatures, or badge emblems. Logos are composited by code afterwards.`,
].join("\n");

/** Fallback on-image line for rows generated before graphic_line existed. */
function fallbackLine(kind: AnnouncementKind, name: string): string {
  return kind === "partner"
    ? `${name} will now be rocking Tilt Hockey products — and we're proud to back their journey on and off the ice.`
    : `Built for players who'd rather lead than follow. Welcome to the squad, ${name}.`;
}

function ambassadorBrief(name: string, subtitle?: string | null): string {
  return [
    `Build a premium ambassador announcement layout AROUND this real player photo (4:5 portrait).`,
    STYLE,
    ``,
    `Layout:`,
    `- Keep the player large on the LEFT side, intact and recognizable.`,
    `- Right side, starting BELOW the reserved top strip, top to bottom: big headline "WELCOME TO THE TEAM" ("WELCOME" white, "TO THE TEAM" cyan);`,
    `  then the player's name "${name.toUpperCase()}" huge in white inside a thin silver outline;`,
    subtitle ? `  then "${subtitle.toUpperCase()}" smaller in white;` : ``,
    `  then "You're officially part of the" in white and "TILT AMBASSADOR CLUB" in bold cyan, with the subline "The ultimate squad for young hockey stars and future legends."`,
    `- TOP: the entire top 18% of the canvas, full width, must be plain background — no text, no shapes, nothing. A wordmark is stamped there by code afterwards, so anything you place there gets covered. Every piece of text starts below that strip.`,
    `- BOTTOM: keep the lowest tenth of the canvas calm and free of text.`,
    `- Render ONLY the exact quoted words above. Never draw placeholder labels (like "WORDMARK", "LOGO", or "TEXT HERE") or any other lettering.`,
    `- Do not draw any logos, crests, signatures, or badges anywhere.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Composites the TILT wordmark (top-center, on a dark backing plate so
 * highlights in the generated art can't wash it out) onto the AMBASSADOR
 * design. Partner graphics don't pass through here anymore — they're built
 * entirely in code by composePartnerGraphic (see compose.ts).
 */
async function composeAmbassador(base: Buffer): Promise<Buffer> {
  const canvas = await sharp(base).resize(W, H, { fit: "cover" }).toBuffer();
  const composites: sharp.OverlayOptions[] = [];

  const logo = await loadLogo();
  if (logo) {
    const logoW = Math.round(W * 0.42);
    const logoBuf = await sharp(logo, { density: 300 })
      .resize({ width: logoW })
      .png()
      .toBuffer();
    const meta = await sharp(logoBuf).metadata();
    const logoH = meta.height ?? Math.round(logoW / 8);

    const padX = Math.round(logoW * 0.12);
    const padY = Math.round(logoH * 0.55);
    const plateW = logoW + padX * 2;
    const plateH = logoH + padY * 2;
    const plate = Buffer.from(
      `<svg width="${plateW}" height="${plateH}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="${plateW}" height="${plateH}" rx="16" fill="${BRAND.colors.black}" fill-opacity="0.85"/>` +
        `<rect y="0" width="${plateW}" height="4" rx="2" fill="${BRAND.colors.cyan}"/>` +
        `</svg>`,
    );

    const plateTop = Math.round(H * 0.025);
    const plateLeft = Math.round((W - plateW) / 2);
    composites.push({ input: plate, left: plateLeft, top: plateTop });
    composites.push({
      input: logoBuf,
      left: plateLeft + padX,
      top: plateTop + padY,
    });
  }

  // Bottom anchor: a soft dark scrim with the T-shield over a small wordmark,
  // centered — code-stamped so the marks are always crisp and never AI-drawn.
  const band = Math.round(H * 0.18);
  const scrim = Buffer.from(
    `<svg width="${W}" height="${band}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${BRAND.colors.black}" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="${BRAND.colors.black}" stop-opacity="0.85"/>` +
      `</linearGradient></defs>` +
      `<rect width="${W}" height="${band}" fill="url(#g)"/>` +
      `</svg>`,
  );
  composites.push({ input: scrim, left: 0, top: H - band });

  const shield = await loadShield();
  let cursorY = H - band + Math.round(band * 0.22);
  if (shield) {
    const shieldW = Math.round(W * 0.085);
    const shieldBuf = await sharp(shield, { density: 300 })
      .resize({ width: shieldW })
      .png()
      .toBuffer();
    const sMeta = await sharp(shieldBuf).metadata();
    const sH = sMeta.height ?? shieldW;
    composites.push({
      input: shieldBuf,
      left: Math.round((W - shieldW) / 2),
      top: cursorY,
    });
    cursorY += sH + Math.round(H * 0.012);
  }
  if (logo) {
    const wmW = Math.round(W * 0.24);
    const wmBuf = await sharp(logo, { density: 300 })
      .resize({ width: wmW })
      .png()
      .toBuffer();
    const wmMeta = await sharp(wmBuf).metadata();
    const wmH = wmMeta.height ?? Math.round(wmW / 8);
    // Never run off the canvas even if the shield is unusually tall.
    const wmTop = Math.min(cursorY, H - wmH - Math.round(H * 0.02));
    composites.push({
      input: wmBuf,
      left: Math.round((W - wmW) / 2),
      top: wmTop,
    });
  }

  return sharp(canvas).composite(composites).png().toBuffer();
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
 * three formats. Ambassador: the model builds the layout around the real photo
 * (4:5 only), then code stamps the wordmark.
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

  const design = await nanoEdit({
    sourceImage: source.buf,
    sourceMimeType: source.mime,
    brief: { brief: ambassadorBrief(a.name, a.subtitle) },
  });
  const final = await composeAmbassador(design.image);

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
