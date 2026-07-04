import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/lib/social/db";
import { assets, studioAssets, type StudioAsset } from "@/lib/social/db/schema";
import { BRAND } from "@/lib/social/brand";
import { mirrorToBlob } from "@/lib/social/blob";
import { nanoCall } from "@/lib/social/render/nano";
import { overlayBranding } from "@/lib/social/render/overlay";
import { composeStudioBrief, type StudioBrief } from "./brief";
import { resolveDimensions } from "./presets";

/**
 * Studio render orchestrator. Takes a freeform request, composes an on-brand
 * brief, generates the image with Nano Banana Pro (a real catalog photo as the
 * base when a subject is involved, otherwise an abstract brand canvas), composites
 * the TILT logo in code, uploads to Blob, and records the result.
 *
 * Same hard rules as the social pipeline: real assets only, logo never AI-drawn.
 */

export type StudioInput = {
  prompt: string;
  preset?: string;
  width?: number;
  height?: number;
  baseAssetId?: string | null;
  withLogo?: boolean;
};

export type StudioOutput = {
  asset: StudioAsset;
  brief: StudioBrief;
  source: "claude" | "fallback";
  safety: { safe: boolean; violations: string[] };
};

/** A black canvas with a cyan radial glow — the brand backdrop for graphic pieces. */
async function brandCanvas(w: number, h: number): Promise<Buffer> {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="78%" cy="18%" r="85%">
      <stop offset="0%" stop-color="${BRAND.colors.cyan}" stop-opacity="0.35"/>
      <stop offset="45%" stop-color="${BRAND.colors.darkGray}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${BRAND.colors.black}" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${BRAND.colors.black}"/>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function studioPrompt(brief: StudioBrief, hasBasePhoto: boolean): string {
  return [
    `You are producing branded artwork for ${BRAND.name}.`,
    `Brand colors — Black ${BRAND.colors.black}, Cyan ${BRAND.colors.cyan}, Dark Gray ${BRAND.colors.darkGray}.`,
    `Display type feel: bold condensed uppercase (${BRAND.fonts.display}).`,
    ``,
    `STRICT RULES:`,
    hasBasePhoto
      ? `- A REAL Tilt photo is provided. Treat/grade/brand/format THAT photo only. Do NOT invent or add new players, sticks, products, or hockey scenes.`
      : `- Produce an ABSTRACT / GRAPHIC / TYPOGRAPHIC composition only. Do NOT generate players, sticks, products, jerseys, crests, logos, or hockey rinks/scenes. Use the provided brand canvas as the base and build on it with brand colors, geometry, light, and texture.`,
    `- Do NOT draw or recreate the TILT logo or any team crest — branding is composited separately by code along the bottom. Leave clean, uncluttered space across the bottom for it.`,
    ``,
    `Concept: ${brief.concept}`,
    `Treatment: ${brief.treatmentBrief}`,
    brief.displayText ? `Render this display text, in brand type: "${brief.displayText}"` : `No display text — keep it clean.`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function fetchBytes(url: string): Promise<{ buf: Buffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch base photo failed: ${res.status}`);
  const mime = res.headers.get("content-type") ?? "image/jpeg";
  return { buf: Buffer.from(await res.arrayBuffer()), mime };
}

export async function generateStudioAsset(input: StudioInput): Promise<StudioOutput> {
  const { width, height, presetKey } = resolveDimensions(input);

  // Load the real base photo, if one was chosen.
  let baseBuf: Buffer | undefined;
  let baseMime: string | undefined;
  let baseDesc: string | null = null;
  if (input.baseAssetId) {
    const a = (await db.select().from(assets).where(eq(assets.id, input.baseAssetId)).limit(1))[0];
    if (!a) throw new Error("Selected base photo was not found in the catalog.");
    if (a.type !== "photo") throw new Error("Base must be a photo.");
    if (!a.blobUrl) throw new Error("Selected base photo has no stored image.");
    const fetched = await fetchBytes(a.blobUrl);
    baseBuf = fetched.buf;
    baseMime = fetched.mime;
    baseDesc = a.tags?.description ?? a.filename;
  }

  const hasBasePhoto = Boolean(baseBuf);

  // 1) Compose the on-brand brief (Claude when available).
  const { brief, safety, source } = await composeStudioBrief({
    prompt: input.prompt,
    width,
    height,
    hasBasePhoto,
    basePhotoDescription: baseDesc,
  });

  // 2) Generate the image. Real photo as base when a subject is involved;
  //    otherwise a code-built brand canvas anchors an abstract/graphic piece.
  const source_ = baseBuf ?? (await brandCanvas(width, height));
  const sourceMime = baseMime ?? "image/png";
  const generated = await nanoCall({
    prompt: studioPrompt(brief, hasBasePhoto),
    sourceImage: source_,
    sourceMimeType: sourceMime,
  });

  // 3) Fit to the exact canvas and composite the brand anchor in code.
  const withLogo = input.withLogo ?? true;
  const branded = await overlayBranding(generated.image, { w: width, h: height }, {
    withBranding: withLogo,
  });

  // 4) Upload + record.
  const url = await mirrorToBlob({
    key: `studio/${randomUUID()}.png`,
    buffer: branded,
    contentType: "image/png",
  });

  const [row] = await db
    .insert(studioAssets)
    .values({
      kind: presetKey,
      title: brief.title,
      prompt: input.prompt,
      brief: brief.treatmentBrief,
      displayText: brief.displayText,
      width,
      height,
      baseAssetId: input.baseAssetId ?? null,
      logo: withLogo,
      renderUrl: url,
    })
    .returning();

  return { asset: row, brief, source, safety };
}
