import "@/lib/social/render/fonts"; // side effect: register the bundled brand font for serverless
import sharp from "sharp";
import { BRAND } from "@/lib/social/brand";
import { loadLogo, loadShield, loadShaft } from "@/lib/social/render/overlay";
import { FONT, xmlEscape, fitFont, wrapLines, backgroundSvg } from "@/lib/social/render/flyer";

/**
 * Deterministic, code-composited PARTNERSHIP announcement. NO image model is
 * involved — same rationale as the flyer engine (see flyer.ts): the model kept
 * drifting on layout, and a fixed template shouldn't cost credits or wait on an
 * API. Every element is placed at a computed position, top to bottom:
 *
 *   WE'RE                     (huge, white)
 *   TEAMING UP                (huge, cyan)
 *   [ WITH {PARTNER} ]        (cyan pill, dark text)
 *   graphic line              (wrapped, light gray)
 *   [partner logo card]       (white rounded card; position/size adjustable,
 *                              optional ×-TILT lockup)
 *   ── TILT wordmark ──       (dark plate pinned to the bottom)
 *
 * Renders any canvas size — the announcement board uses 4:5, 1:1, and 9:16.
 */

export type LogoPosition = "left" | "center" | "right";
export type LogoScale = "sm" | "md" | "lg";

export type PartnerLayout = {
  logoPosition: LogoPosition;
  logoScale: LogoScale;
  /** Show the partner mark and the TILT mark side by side with an ×. */
  lockup: boolean;
};

export const DEFAULT_PARTNER_LAYOUT: PartnerLayout = {
  logoPosition: "center",
  logoScale: "md",
  lockup: false,
};

export type PartnerGraphicInput = {
  /** Partner name — typeset inside the pill as "WITH {NAME}". */
  name: string;
  /** One sentence typeset under the pill (the brain's graphicLine). */
  line: string;
  /** The uploaded partner logo (PNG/JPEG/WebP bytes). */
  partnerLogo: Buffer;
  /** Partner website — typeset in small caps under the logo card. */
  website?: string | null;
  /** Partner accent hex (#RRGGBB) — logo-card border + website line color. */
  accentColor?: string | null;
  layout?: Partial<PartnerLayout> | null;
  width?: number;
  height?: number;
};

const SCALE_H: Record<LogoScale, number> = { sm: 0.55, md: 0.72, lg: 0.9 };
const SCALE_W: Record<LogoScale, number> = { sm: 0.26, md: 0.34, lg: 0.44 };

/** Normalizes "00a7e1" / "#0af" / " #00A7E1 " → "#00A7E1"; null if not a hex color. */
export function normalizeAccent(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(t)) return `#${t.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(t)) {
    return `#${t.split("").map((c) => c + c).join("").toUpperCase()}`;
  }
  return null;
}

/**
 * Crops dead space (white JPEG margins / transparent PNG padding) off an
 * uploaded logo so the white card hugs the actual mark. Falls back to the
 * original bytes if trimming fails or eats the whole image.
 */
export async function trimLogo(logo: Buffer): Promise<Buffer> {
  try {
    const trimmed = await sharp(logo).trim({ threshold: 16 }).png().toBuffer();
    const meta = await sharp(trimmed).metadata();
    if ((meta.width ?? 0) >= 8 && (meta.height ?? 0) >= 8) return trimmed;
  } catch {
    /* fall through to the untrimmed original */
  }
  return sharp(logo).png().toBuffer();
}

/** Subtle dark checker texture layered over the shared flyer backdrop. */
function checkerSvg(W: number, H: number): string {
  const s = Math.round(W / 15);
  return (
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><pattern id="chk" width="${s * 2}" height="${s * 2}" patternUnits="userSpaceOnUse">` +
    `<rect width="${s}" height="${s}" fill="#ffffff" fill-opacity="0.015"/>` +
    `<rect x="${s}" y="${s}" width="${s}" height="${s}" fill="#ffffff" fill-opacity="0.015"/>` +
    `</pattern></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#chk)"/></svg>`
  );
}

/**
 * White rounded card with the (already trimmed+fitted) logo centered in it.
 * When a partner accent color is set, the card gets a border in that color —
 * the one consistent place partner colors appear on the layout.
 */
function cardFor(
  lw: number,
  lh: number,
  accent?: string | null,
): { svg: Buffer; w: number; h: number; pad: number } {
  // Generous padding: trimLogo strips the logo's own margins, so the card has
  // to give them back — a tight card reads as the mark blown up to fit.
  const pad = Math.round(Math.max(lw, lh) * 0.24);
  const w = lw + pad * 2;
  const h = lh + pad * 2;
  const sw = accent ? Math.max(5, Math.round(pad * 0.3)) : 0;
  const stroke = accent
    ? `<rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" rx="${Math.round(pad * 1.2)}" fill="none" stroke="${accent}" stroke-width="${sw}"/>`
    : "";
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${w}" height="${h}" rx="${Math.round(pad * 1.2)}" fill="#ffffff"/>${stroke}</svg>`,
  );
  return { svg, w, h, pad };
}

/**
 * The T shield tiled as a faint, slightly rotated step-and-repeat across the
 * whole canvas (event-tent style), layered between the backdrop and the text.
 * Returns null when no shield asset exists.
 */
async function shieldPatternSvg(W: number, H: number): Promise<Buffer | null> {
  const shield = await loadShield();
  if (!shield) return null;
  const tileW = Math.round(W * 0.055);
  const tile = await sharp(shield, { density: 300 }).resize({ width: tileW }).png().toBuffer();
  const meta = await sharp(tile).metadata();
  const th = meta.height ?? tileW;
  const b64 = tile.toString("base64");

  // Explicit staggered rows instead of an SVG <pattern> — librsvg stretches
  // pattern content to the cell, which blew the tiles up into merged bands.
  // The image is defined once in <defs> and stamped with <use>. Level rows
  // (no rotation), alternate rows offset half a step, brickwork style.
  const stepX = Math.round(tileW * 2.8);
  const stepY = Math.round(th * 2.3);
  const stamps: string[] = [];
  let row = 0;
  for (let y = Math.round(th * 0.4); y < H; y += stepY, row++) {
    const xOffset = row % 2 === 0 ? 0 : Math.round(stepX / 2);
    for (let x = -stepX; x < W + stepX; x += stepX) {
      stamps.push(`<use href="#tsh" xlink:href="#tsh" x="${x + xOffset}" y="${y}"/>`);
    }
  }
  return Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">` +
      `<defs><image id="tsh" width="${tileW}" height="${th}" href="data:image/png;base64,${b64}" xlink:href="data:image/png;base64,${b64}"/></defs>` +
      `<g opacity="0.13">${stamps.join("")}</g>` +
      `</svg>`,
  );
}

/**
 * A soft blurred drop shadow for a rounded card of size w×h. Returns the shadow
 * layer plus the margin it was padded by, so the caller can place it behind the
 * card (offset a touch downward reads as "lifted off the background").
 */
function shadowFor(w: number, h: number, rx: number): { svg: Buffer; margin: number } {
  const margin = Math.round(Math.max(w, h) * 0.16);
  const bw = w + margin * 2;
  const bh = h + margin * 2;
  const blur = Math.round(Math.max(w, h) * 0.04);
  const svg = Buffer.from(
    `<svg width="${bw}" height="${bh}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><filter id="sh" x="-40%" y="-40%" width="180%" height="180%">` +
      `<feGaussianBlur stdDeviation="${blur}"/></filter></defs>` +
      `<rect x="${margin}" y="${margin}" width="${w}" height="${h}" rx="${rx}" ` +
      `fill="#000000" fill-opacity="0.55" filter="url(#sh)"/></svg>`,
  );
  return { svg, margin };
}

/**
 * The holo shaft as vertical rails along both sides — spanning the full
 * height, near-opaque, so the stick graphics (hex texture, TILT shaft art)
 * actually show. The right rail is mirrored for symmetry. Text layers render
 * on top. Null when no shaft asset exists.
 */
async function shaftRailsSvg(W: number, H: number): Promise<Buffer | null> {
  const shaft = await loadShaft();
  if (!shaft) return null;
  const meta = await sharp(shaft).metadata();
  const sw0 = meta.width ?? 52;
  const sh0 = meta.height ?? 1104;
  // Oversized, anchored with the butt end visible near the top: the shaft's
  // own TILT wordmark (~a fifth down the strip) lands beside the headline,
  // and only the bottom cut end leaves the frame.
  const sh = Math.round(H * 1.25);
  const sw = Math.round((sh * sw0) / sh0);
  const b64 = shaft.toString("base64");
  const top = Math.round(H * 0.06);
  const inset = Math.round(W * 0.045); // rail centerline distance from the edge
  const leftX = inset - Math.round(sw / 2);
  const rightX = W - inset - Math.round(sw / 2);
  const img = `<image width="${sw}" height="${sh}" href="data:image/png;base64,${b64}" xlink:href="data:image/png;base64,${b64}"/>`;
  return Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">` +
      `<g opacity="0.92">` +
      `<g transform="translate(${leftX} ${top})">${img}</g>` +
      // no mirroring on the right rail — it would flip the TILT shaft wordmark
      `<g transform="translate(${rightX} ${top})">${img}</g>` +
      `</g></svg>`,
  );
}

export async function composePartnerGraphic(input: PartnerGraphicInput): Promise<Buffer> {
  const W = input.width ?? 1080;
  const H = input.height ?? 1350;
  const cyan = BRAND.colors.cyan;
  const layout: PartnerLayout = { ...DEFAULT_PARTNER_LAYOUT, ...(input.layout ?? {}) };

  const accent = /^#[0-9a-fA-F]{6}$/.test(input.accentColor ?? "") ? input.accentColor! : null;

  const base = await sharp(Buffer.from(backgroundSvg(W, H))).png().toBuffer();
  // T-shield step-and-repeat is the backdrop texture; the checker only fills
  // in when no shield asset exists (they fight each other layered together).
  const shieldLayer = await shieldPatternSvg(W, H);
  const composites: sharp.OverlayOptions[] = [
    shieldLayer
      ? { input: shieldLayer, left: 0, top: 0 }
      : { input: Buffer.from(checkerSvg(W, H)), left: 0, top: 0 },
  ];
  const shaftLayer = await shaftRailsSvg(W, H);
  if (shaftLayer) composites.push({ input: shaftLayer, left: 0, top: 0 });
  const texts: string[] = [];
  const cx = Math.round(W / 2);

  const shadow = (t: string, fx: number, fy: number, size: number, ls: number) =>
    `<text x="${cx}" y="${fy + Math.round(size * 0.04) + 3}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${size}" letter-spacing="${ls}" fill="#000000" fill-opacity="0.38">${t}</text>`;

  // --- Eyebrow kicker + accent rule, to anchor the top. ---
  const eb = Math.round(Math.min(W * 0.046, H * 0.038));
  let y = Math.round(H * 0.055) + eb;
  texts.push(
    `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="${eb}" letter-spacing="${Math.round(eb * 0.5)}" fill="${cyan}">OFFICIAL PARTNERSHIP</text>`,
  );
  const ruleW = Math.round(W * 0.13);
  const ruleY = y + Math.round(eb * 0.55);
  texts.push(
    `<rect x="${cx - Math.round(ruleW / 2)}" y="${ruleY}" width="${ruleW}" height="3" rx="1.5" fill="${cyan}" fill-opacity="0.8"/>`,
  );

  // --- Headline: WE'RE (white) / TEAMING UP (cyan), with soft depth. ---
  const size1 = fitFont("WE'RE", Math.round(W * 0.8), Math.round(Math.min(W * 0.14, H * 0.12)), 0.62);
  y = ruleY + Math.round(H * 0.022) + size1;
  texts.push(
    shadow("WE&apos;RE", cx, y, size1, 2),
    `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${size1}" letter-spacing="2" fill="#ffffff">WE&apos;RE</text>`,
  );
  const size2 = fitFont("TEAMING UP", Math.round(W * 0.92), Math.round(Math.min(W * 0.155, H * 0.135)), 0.62);
  y += Math.round(size2 * 1.04);
  texts.push(
    shadow("TEAMING UP", cx, y, size2, 2),
    `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${size2}" letter-spacing="2" fill="${cyan}">TEAMING UP</text>`,
  );

  // --- Cyan pill: WITH {NAME}. ---
  const pillText = `WITH ${input.name.toUpperCase()}`;
  const pf = fitFont(pillText, Math.round(W * 0.72), Math.round(Math.min(W * 0.056, H * 0.048)), 0.56);
  const pillH = Math.round(pf * 2);
  const pillW = Math.min(Math.round(W * 0.88), Math.round(pillText.length * pf * 0.56 + pf * 2.4));
  const pillTop = y + Math.round(H * 0.028);
  texts.push(
    `<rect x="${cx - Math.round(pillW / 2)}" y="${pillTop}" width="${pillW}" height="${pillH}" rx="${Math.round(pillH / 2)}" fill="${cyan}"/>`,
    `<text x="${cx}" y="${pillTop + Math.round(pillH / 2 + pf * 0.36)}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${pf}" letter-spacing="1" fill="${BRAND.colors.black}">${xmlEscape(pillText)}</text>`,
  );
  y = pillTop + pillH;

  // --- Graphic line, wrapped + centered. ---
  const pgf = Math.round(Math.min(W * 0.031, H * 0.027));
  const lineH = Math.round(pgf * 1.4);
  const lines = wrapLines(input.line.trim(), Math.floor((W * 0.8) / (pgf * 0.47))).slice(0, 3);
  let paraY = y + Math.round(H * 0.03) + pgf;
  for (const ln of lines) {
    texts.push(
      `<text x="${cx}" y="${paraY}" text-anchor="middle" font-family="${FONT}" font-weight="500" font-size="${pgf}" fill="#d7dbe0">${xmlEscape(ln)}</text>`,
    );
    paraY += lineH;
  }
  const paraBottom = paraY - lineH + Math.round(pgf * 0.4);

  texts.length &&
    composites.push({
      input: Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${texts.join("")}</svg>`,
      ),
      left: 0,
      top: 0,
    });

  // --- TILT wordmark on a dark plate, pinned bottom-center. ---
  const tilt = await loadLogo();
  let plateTop = H - Math.round(H * 0.09); // fallback zone floor if no logo file
  if (tilt) {
    const logoW = Math.round(W * 0.42);
    const logoBuf = await sharp(tilt, { density: 300 }).resize({ width: logoW }).png().toBuffer();
    const meta = await sharp(logoBuf).metadata();
    const logoH = meta.height ?? Math.round(logoW / 8);
    const padX = Math.round(logoW * 0.12);
    const padY = Math.round(logoH * 0.55);
    const plateW = logoW + padX * 2;
    const plateH = logoH + padY * 2;
    plateTop = H - plateH - Math.round(H * 0.025);
    const plateLeft = Math.round((W - plateW) / 2);
    composites.push({
      input: Buffer.from(
        `<svg width="${plateW}" height="${plateH}" xmlns="http://www.w3.org/2000/svg">` +
          `<rect width="${plateW}" height="${plateH}" rx="16" fill="${BRAND.colors.black}" fill-opacity="0.85"/>` +
          `<rect y="0" width="${plateW}" height="4" rx="2" fill="${cyan}"/></svg>`,
      ),
      left: plateLeft,
      top: plateTop,
    });
    composites.push({ input: logoBuf, left: plateLeft + padX, top: plateTop + padY });
  }

  // --- Partner logo card in the zone between the paragraph and the plate. ---
  // When a website is set, a text band is reserved BELOW the zone so the line
  // can never be covered by the card (tall square logos make tall cards).
  const site = input.website
    ?.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toUpperCase();
  const wf = site
    ? fitFont(site, Math.round(W * 0.5), Math.round(Math.min(W * 0.027, H * 0.023)), 0.52)
    : 0;
  const bandH = site ? Math.round(wf * 2.1) : 0;
  const zoneTop = paraBottom + Math.round(H * 0.015);
  const zoneBottom = plateTop - Math.round(H * 0.02) - bandH;
  const zoneH = Math.max(zoneBottom - zoneTop, Math.round(H * 0.08));

  const maxH = Math.round(Math.min(zoneH * SCALE_H[layout.logoScale], H * 0.2));
  const maxW = Math.round(W * SCALE_W[layout.logoScale]);
  // The mark sits at ~82% of the box and the card pads the rest — the logo
  // should look like itself with air around it, not zoomed in to fill.
  const logoFit = await sharp(await trimLogo(input.partnerLogo))
    .resize(Math.round(maxW * 0.82), Math.round(maxH * 0.82), { fit: "inside" })
    .png()
    .toBuffer();
  const lmeta = await sharp(logoFit).metadata();
  const lw = lmeta.width ?? maxW;
  const lh = lmeta.height ?? maxH;
  const card = cardFor(lw, lh, accent);

  // Lockup: [partner card] × [dark TILT plate of the same size].
  let tiltCard: { buf: Buffer; logo: Buffer; lw: number; lh: number } | null = null;
  const gap = Math.round(card.h * 0.28);
  const xSize = Math.round(card.h * 0.42);
  let totalW = card.w;
  if (layout.lockup && tilt) {
    const tl = await sharp(tilt, { density: 300 })
      .resize(Math.round(card.w * 0.76), Math.round(card.h * 0.56), { fit: "inside" })
      .png()
      .toBuffer();
    const tm = await sharp(tl).metadata();
    tiltCard = {
      buf: Buffer.from(
        `<svg width="${card.w}" height="${card.h}" xmlns="http://www.w3.org/2000/svg">` +
          `<rect width="${card.w}" height="${card.h}" rx="${Math.round(card.pad * 1.2)}" fill="#15181c" stroke="#2a2f36" stroke-width="2"/></svg>`,
      ),
      logo: tl,
      lw: tm.width ?? Math.round(card.w * 0.76),
      lh: tm.height ?? Math.round(card.h * 0.56),
    };
    totalW = card.w + gap + xSize + gap + card.w;
  }

  const margin = Math.round(W * 0.06);
  const startX =
    layout.logoPosition === "left"
      ? margin
      : layout.logoPosition === "right"
        ? W - margin - totalW
        : Math.round((W - totalW) / 2);
  const cardTop = zoneTop + Math.round((zoneH - card.h) / 2);

  const cardShadow = shadowFor(card.w, card.h, Math.round(card.pad * 1.2));
  composites.push({
    input: cardShadow.svg,
    left: startX - cardShadow.margin,
    top: cardTop - cardShadow.margin + Math.round(card.h * 0.05),
  });
  composites.push({ input: card.svg, left: startX, top: cardTop });
  composites.push({
    input: logoFit,
    left: startX + Math.round((card.w - lw) / 2),
    top: cardTop + Math.round((card.h - lh) / 2),
  });

  if (tiltCard) {
    const xLeft = startX + card.w + gap;
    composites.push({
      input: Buffer.from(
        `<svg width="${xSize}" height="${card.h}" xmlns="http://www.w3.org/2000/svg">` +
          `<text x="${Math.round(xSize / 2)}" y="${Math.round(card.h / 2 + xSize * 0.34)}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${xSize}" fill="${cyan}">&#215;</text></svg>`,
      ),
      left: xLeft,
      top: cardTop,
    });
    const tcLeft = xLeft + xSize + gap;
    composites.push({
      input: cardShadow.svg,
      left: tcLeft - cardShadow.margin,
      top: cardTop - cardShadow.margin + Math.round(card.h * 0.05),
    });
    composites.push({ input: tiltCard.buf, left: tcLeft, top: cardTop });
    composites.push({
      input: tiltCard.logo,
      left: tcLeft + Math.round((card.w - tiltCard.lw) / 2),
      top: cardTop + Math.round((card.h - tiltCard.lh) / 2),
    });
  }

  // --- Partner website, small caps in its reserved band under the logo row. ---
  if (site) {
    const wy = Math.max(zoneBottom, cardTop + card.h) + Math.round(wf * 1.25);
    const wx = startX + Math.round(totalW / 2); // centered under the logo row
    // Dark shadow copy first so the line stays crisp over the stick's blade.
    composites.push({
      input: Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
          `<text x="${wx}" y="${wy + 2}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${wf}" letter-spacing="${Math.round(wf * 0.28)}" fill="#000000" fill-opacity="0.55">${xmlEscape(site)}</text>` +
          `<text x="${wx}" y="${wy}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${wf}" letter-spacing="${Math.round(wf * 0.28)}" fill="${accent ?? cyan}">${xmlEscape(site)}</text></svg>`,
      ),
      left: 0,
      top: 0,
    });
  }

  return sharp(base).composite(composites).png().toBuffer();
}
