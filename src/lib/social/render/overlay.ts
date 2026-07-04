import sharp from "sharp";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Code-side branding overlay (Phase 3).
 *
 * HARD BRAND RULE: the TILT logo (and team crests) are NEVER rendered by an AI
 * model. Nano Banana Pro handles the photo treatment + display text; THIS code
 * composites the branding afterward, pixel-perfect.
 *
 * The brand ANCHOR: every generated visual gets a solid black band across the
 * bottom with a cyan rule and the TILT HOCKEY wordmark large and centered —
 * the same spot on every post, regardless of what the AI did to the photo.
 */

export type RenderFormat = "static" | "carousel" | "reel";

/** Explicit pixel dimensions (used by the Studio for arbitrary canvas sizes). */
export type Dims = { w: number; h: number };

// Anchor tuning — one place to adjust prominence.
const BAND_HEIGHT_RATIO = 0.11; // brand band = 11% of canvas height
const LOGO_WIDTH_RATIO = 0.5; // wordmark = 50% of canvas width
const RULE_HEIGHT = 6; // cyan rule on the band's top edge (px)
const TILT_BLACK = "#0d0d0d";
const TILT_CYAN = "#00bfff";

export function dimsFor(format: RenderFormat): Dims {
  switch (format) {
    case "reel":
      return { w: 1080, h: 1920 }; // 9:16
    case "carousel":
      return { w: 1080, h: 1080 }; // 1:1
    case "static":
    default:
      return { w: 1080, h: 1350 }; // 4:5
  }
}

export async function loadLogo(): Promise<Buffer | null> {
  // Prefer the white PNG; fall back to the SVG.
  const candidates = ["tilt-logo.png", "tilt-logo.svg"];
  for (const name of candidates) {
    try {
      return await readFile(join(process.cwd(), "public", "brand", name));
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * The T shield mark, used as a faint repeating background pattern on
 * code-composited graphics. Drop the real transparent PNG in as
 * public/brand/t-shield.png (same convention as the wordmark); a placeholder
 * SVG ships so the pattern works out of the box.
 */
export async function loadShield(): Promise<Buffer | null> {
  const candidates = ["t-shield.png", "t-shield.svg", join("marks", "t-shield.png")];
  for (const name of candidates) {
    try {
      return await readFile(join(process.cwd(), "public", "brand", name));
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * The extracted holo stick render (transparent PNG, blade lower-left, shaft
 * rising to the right) — kept for compositions that want the whole stick.
 */
export async function loadStick(): Promise<Buffer | null> {
  const candidates = ["stick-holo-white.png", "stick-holo-black.png"];
  for (const name of candidates) {
    try {
      return await readFile(join(process.cwd(), "public", "brand", name));
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * The shaft close-up segment, pre-rotated upright (transparent PNG, hex
 * texture + TILT shaft graphics) — composited as vertical rails along the
 * sides of partnership graphics to show off the stick graphics.
 */
export async function loadShaft(): Promise<Buffer | null> {
  // Black first — the white TILT shaft graphics pop on it (founder's pick).
  const candidates = ["stick-shaft-black.png", "stick-shaft-white.png"];
  for (const name of candidates) {
    try {
      return await readFile(join(process.cwd(), "public", "brand", name));
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * The brand anchor as a standalone PNG (black band, cyan rule, centered
 * wordmark) sized for a w×h canvas. Shared by the static pipeline (composited
 * directly) and the video pipeline (published to Blob for Shotstack).
 */
export async function anchorBandFor(
  w: number,
  h: number,
): Promise<{ buffer: Buffer; height: number }> {
  const bandH = Math.round(h * BAND_HEIGHT_RATIO);
  const band = Buffer.from(
    `<svg width="${w}" height="${bandH}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${w}" height="${bandH}" fill="${TILT_BLACK}"/>` +
      `<rect width="${w}" height="${RULE_HEIGHT}" fill="${TILT_CYAN}"/>` +
      `</svg>`,
  );

  const composites: sharp.OverlayOptions[] = [];
  const logo = await loadLogo();
  if (logo) {
    const logoW = Math.round(w * LOGO_WIDTH_RATIO);
    const logoBuf = await sharp(logo, { density: 300 })
      .resize({ width: logoW })
      .png()
      .toBuffer();
    const meta = await sharp(logoBuf).metadata();
    const logoH = meta.height ?? Math.round(logoW / 8);
    composites.push({
      input: logoBuf,
      top: RULE_HEIGHT + Math.round((bandH - RULE_HEIGHT - logoH) / 2),
      left: Math.round((w - logoW) / 2),
    });
  }

  const buffer = await sharp(band).composite(composites).png().toBuffer();
  return { buffer, height: bandH };
}

/**
 * Extra brand marks (T shield, team crests like the Komoka crown): any PNG
 * dropped in public/brand/marks/ is composited top-left, stacked, on every
 * render — no code change needed to add one.
 */
async function loadExtraMarks(): Promise<Buffer[]> {
  try {
    const dir = join(process.cwd(), "public", "brand", "marks");
    const names = (await readdir(dir)).filter((n) => /\.png$/i.test(n)).sort();
    return await Promise.all(names.map((n) => readFile(join(dir, n))));
  } catch {
    return []; // folder doesn't exist yet
  }
}

/**
 * Fits the (already AI-treated) base image to the target aspect, then anchors
 * the brand: bottom band + cyan rule + centered wordmark, plus any extra marks
 * top-left. Returns a PNG buffer.
 *
 * `format` accepts a social RenderFormat or explicit Dims (the Studio uses
 * arbitrary canvas sizes). Set `opts.withBranding = false` for a full-bleed
 * piece with no band/marks (e.g. a clean desktop wallpaper).
 */
export async function overlayBranding(
  baseImage: Buffer,
  format: RenderFormat | Dims,
  opts?: { crests?: Buffer[]; withBranding?: boolean },
): Promise<Buffer> {
  const { w, h } = typeof format === "string" ? dimsFor(format) : format;

  const base = await sharp(baseImage)
    .resize(w, h, { fit: "cover", position: "attention" })
    .toBuffer();

  if (opts?.withBranding === false) {
    return sharp(base).png().toBuffer();
  }

  const composites: sharp.OverlayOptions[] = [];

  // 1) The anchor: band + cyan rule + centered wordmark, pinned to the bottom.
  const band = await anchorBandFor(w, h);
  composites.push({ input: band.buffer, top: h - band.height, left: 0 });

  // 2) Extra marks (T shield, team crests) — top-left, stacked, code-only.
  const crests = opts?.crests ?? (await loadExtraMarks());
  let crestTop = Math.round(h * 0.05);
  for (const crest of crests) {
    const crestW = Math.round(w * 0.16);
    const crestBuf = await sharp(crest).resize({ width: crestW }).png().toBuffer();
    const cmeta = await sharp(crestBuf).metadata();
    composites.push({ input: crestBuf, top: crestTop, left: Math.round(w * 0.05) });
    crestTop += (cmeta.height ?? crestW) + Math.round(h * 0.02);
  }

  return sharp(base).composite(composites).png().toBuffer();
}
