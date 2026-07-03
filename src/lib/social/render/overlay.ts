import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Code-side branding overlay (Phase 3).
 *
 * HARD BRAND RULE: the TILT logo (and team crests) are NEVER rendered by an AI
 * model. Nano Banana Pro handles the photo treatment + display text; THIS code
 * composites the logo as a fixed PNG/SVG overlay, pixel-perfect, afterward.
 */

export type RenderFormat = "static" | "carousel" | "reel";

export function dimsFor(format: RenderFormat): { w: number; h: number } {
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

async function loadLogo(): Promise<Buffer | null> {
  // Prefer a real PNG if dropped in; fall back to the placeholder SVG.
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
 * Fits the (already AI-treated) base image to the target aspect and composites
 * the TILT logo in the lower-right with a margin. Returns a PNG buffer.
 */
export async function overlayBranding(
  baseImage: Buffer,
  format: RenderFormat,
  opts?: { logo?: Buffer; crests?: Buffer[] },
): Promise<Buffer> {
  const { w, h } = dimsFor(format);

  const base = await sharp(baseImage)
    .resize(w, h, { fit: "cover", position: "attention" })
    .toBuffer();

  const composites: sharp.OverlayOptions[] = [];

  const logo = opts?.logo ?? (await loadLogo());
  if (logo) {
    const logoW = Math.round(w * 0.24);
    const logoBuf = await sharp(logo, { density: 300 })
      .resize({ width: logoW })
      .png()
      .toBuffer();
    const meta = await sharp(logoBuf).metadata();
    const margin = Math.round(w * 0.05);
    composites.push({
      input: logoBuf,
      top: h - (meta.height ?? logoW / 3) - margin,
      left: w - (meta.width ?? logoW) - margin,
    });
  }

  // Team crests (e.g. Komoka crown) — composited top-left, also code-only.
  let crestTop = Math.round(h * 0.05);
  for (const crest of opts?.crests ?? []) {
    const crestW = Math.round(w * 0.16);
    const crestBuf = await sharp(crest).resize({ width: crestW }).png().toBuffer();
    const cmeta = await sharp(crestBuf).metadata();
    composites.push({ input: crestBuf, top: crestTop, left: Math.round(w * 0.05) });
    crestTop += (cmeta.height ?? crestW) + Math.round(h * 0.02);
  }

  return sharp(base).composite(composites).png().toBuffer();
}
