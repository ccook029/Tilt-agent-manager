import "@/lib/social/render/fonts"; // side effect: register the bundled brand font for serverless
import sharp from "sharp";
import { BRAND } from "@/lib/social/brand";
import { loadLogo } from "@/lib/social/render/overlay";

/**
 * Deterministic, code-composited flyer. NO image model is involved in the
 * layout — every element is placed at a fixed position so nothing ever overlaps
 * or gets cut off:
 *
 *   [headline top / headline bottom]   (top)
 *   [hero image — blanket or socks]    (upper-middle, contained whole)
 *   [tagline]                          (under the hero)
 *   [info primary / secondary / tert]  (price, pre-order/date, email)
 *   [TILT wordmark]                    (pinned to the bottom)
 *
 * Used by both the blanket fundraiser flyer and the sock pitch flyer so they
 * look identical structurally.
 */

const DEFAULT_W = 1080;
const DEFAULT_H = 1350;

export type FlyerInput = {
  /** The hero product image (blanket render or sock mockup). */
  hero: Buffer;
  /** Big headline, line 1 (white) — e.g. the org name. */
  headlineTop: string;
  /** Big headline, line 2 (cyan) — e.g. "FUNDRAISER" / "DRESS SOCKS". */
  headlineBottom: string;
  /** One supporting sentence under the hero (white). */
  tagline?: string | null;
  /** Emphasis line above the wordmark (cyan) — e.g. "$60 PER BLANKET". */
  infoPrimary?: string | null;
  /** Second info line (white) — e.g. "PRE-ORDER UNTIL JULY 31ST". */
  infoSecondary?: string | null;
  /** Third info line, small (light gray) — e.g. "E-TRANSFER: x@y.com". */
  infoTertiary?: string | null;
  width?: number;
  height?: number;
};

export const FONT = `'Barlow Condensed','Arial Narrow',Arial,'Helvetica Neue',sans-serif`;

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Pick a font size so `text` fits within `maxWidth` (rough bold-sans metric). */
export function fitFont(text: string, maxWidth: number, desired: number, k = 0.6): number {
  const est = maxWidth / Math.max(text.length, 1) / k;
  return Math.max(16, Math.min(desired, Math.floor(est)));
}

/** Greedy word-wrap into lines no longer than `maxChars`. */
export function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Branded backdrop: dark gradient + cyan glow + silver corner ribbons. */
export function backgroundSvg(W: number, H: number): string {
  const a = Math.round(W * 0.04); // ribbon inner offset
  const b = Math.round(W * 0.12); // ribbon outer offset
  const ribbon = (d: string) => `<path d="${d}" fill="url(#silver)" opacity="0.9"/>`;
  return [
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`,
    `<defs>`,
    `<radialGradient id="glow" cx="80%" cy="10%" r="95%">`,
    `<stop offset="0%" stop-color="${BRAND.colors.cyan}" stop-opacity="0.22"/>`,
    `<stop offset="45%" stop-color="#101317" stop-opacity="1"/>`,
    `<stop offset="100%" stop-color="${BRAND.colors.black}" stop-opacity="1"/>`,
    `</radialGradient>`,
    `<linearGradient id="silver" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `<stop offset="0%" stop-color="#7a828c"/>`,
    `<stop offset="48%" stop-color="#eef1f4"/>`,
    `<stop offset="60%" stop-color="#ffffff"/>`,
    `<stop offset="100%" stop-color="#9aa1aa"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" fill="${BRAND.colors.black}"/>`,
    `<rect width="${W}" height="${H}" fill="url(#glow)"/>`,
    ribbon(`M0,${a} L${a},0 L${b},0 L0,${b} Z`),
    ribbon(`M${W},${a} L${W - a},0 L${W - b},0 L${W},${b} Z`),
    ribbon(`M0,${H - a} L${a},${H} L${b},${H} L0,${H - b} Z`),
    ribbon(`M${W},${H - a} L${W - a},${H} L${W - b},${H} L${W},${H - b} Z`),
    `</svg>`,
  ].join("");
}

export async function composeFlyer(input: FlyerInput): Promise<Buffer> {
  const W = input.width ?? DEFAULT_W;
  const H = input.height ?? DEFAULT_H;
  const cyan = BRAND.colors.cyan;

  const base = await sharp(Buffer.from(backgroundSvg(W, H))).png().toBuffer();
  const composites: sharp.OverlayOptions[] = [];

  // --- Hero: contained whole inside a fixed box (never cropped). ---
  const boxX = Math.round(W * 0.13);
  const boxW = Math.round(W * 0.74);
  const boxY = Math.round(H * 0.185);
  const boxH = Math.round(H * 0.46);
  const heroFit = await sharp(input.hero)
    .resize(boxW, boxH, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  const hmeta = await sharp(heroFit).metadata();
  const hw = hmeta.width ?? boxW;
  const hh = hmeta.height ?? boxH;
  const heroLeft = boxX + Math.round((boxW - hw) / 2);
  const heroTop = boxY + Math.round((boxH - hh) / 2);

  // Soft drop shadow behind the hero.
  const pad = 22;
  const shadow = await sharp(
    Buffer.from(
      `<svg width="${hw + pad * 2}" height="${hh + pad * 2}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="${pad}" y="${pad}" width="${hw}" height="${hh}" rx="14" fill="#000000" fill-opacity="0.5"/>` +
        `</svg>`,
    ),
  )
    .blur(18)
    .png()
    .toBuffer();
  composites.push({ input: shadow, left: heroLeft - pad + 6, top: heroTop - pad + 12 });
  composites.push({ input: heroFit, left: heroLeft, top: heroTop });

  // --- Text overlay (one SVG, absolute positions). ---
  const cx = Math.round(W / 2);
  const headMax = Math.round(W * 0.92);
  const topText = input.headlineTop.toUpperCase();
  const botText = input.headlineBottom.toUpperCase();
  const size1 = fitFont(topText, headMax, Math.round(H * 0.06), 0.62);
  const size2 = fitFont(botText, headMax, Math.round(H * 0.078), 0.62);
  const y1 = Math.round(H * 0.03) + size1;
  const y2 = y1 + size2 + Math.round(H * 0.004);

  const texts: string[] = [
    `<text x="${cx}" y="${y1}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${size1}" letter-spacing="1" fill="#ffffff">${xmlEscape(topText)}</text>`,
    `<text x="${cx}" y="${y2}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${size2}" letter-spacing="1" fill="${cyan}">${xmlEscape(botText)}</text>`,
  ];

  // Tagline under the hero, wrapped + centered.
  if (input.tagline?.trim()) {
    const tFont = Math.round(H * 0.023);
    const maxChars = Math.floor((W * 0.8) / (tFont * 0.5));
    const lines = wrapLines(input.tagline.trim(), maxChars).slice(0, 2);
    const lineH = Math.round(tFont * 1.28);
    const center = Math.round(H * 0.7);
    const start = center - ((lines.length - 1) * lineH) / 2 + Math.round(tFont * 0.34);
    lines.forEach((ln, i) => {
      texts.push(
        `<text x="${cx}" y="${start + i * lineH}" text-anchor="middle" font-family="${FONT}" font-weight="500" font-size="${tFont}" fill="#e5e7eb">${xmlEscape(ln)}</text>`,
      );
    });
  }

  // Info block (price / pre-order / email) above the wordmark.
  const infoMax = Math.round(W * 0.9);
  if (input.infoPrimary?.trim()) {
    const t = input.infoPrimary.trim().toUpperCase();
    const fs = fitFont(t, infoMax, Math.round(H * 0.044), 0.58);
    texts.push(
      `<text x="${cx}" y="${Math.round(H * 0.788)}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${fs}" letter-spacing="1" fill="${cyan}">${xmlEscape(t)}</text>`,
    );
  }
  if (input.infoSecondary?.trim()) {
    const t = input.infoSecondary.trim().toUpperCase();
    const fs = fitFont(t, infoMax, Math.round(H * 0.028), 0.56);
    texts.push(
      `<text x="${cx}" y="${Math.round(H * 0.83)}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${fs}" letter-spacing="1" fill="#ffffff">${xmlEscape(t)}</text>`,
    );
  }
  if (input.infoTertiary?.trim()) {
    const t = input.infoTertiary.trim();
    const fs = fitFont(t, infoMax, Math.round(H * 0.021), 0.5);
    texts.push(
      `<text x="${cx}" y="${Math.round(H * 0.862)}" text-anchor="middle" font-family="${FONT}" font-weight="500" font-size="${fs}" fill="#cbd5e1">${xmlEscape(t)}</text>`,
    );
  }

  const overlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${texts.join("")}</svg>`;
  composites.push({ input: Buffer.from(overlay), left: 0, top: 0 });

  // --- TILT wordmark pinned to the bottom, with a cyan rule above it. ---
  const logo = await loadLogo();
  if (logo) {
    const logoW = Math.round(W * 0.4);
    const logoBuf = await sharp(logo, { density: 300 })
      .resize({ width: logoW })
      .png()
      .toBuffer();
    const lmeta = await sharp(logoBuf).metadata();
    const logoH = lmeta.height ?? Math.round(logoW / 8);
    const bottomMargin = Math.round(H * 0.032);
    const logoTop = H - bottomMargin - logoH;
    composites.push({ input: logoBuf, left: Math.round((W - logoW) / 2), top: logoTop });

    const ruleW = Math.round(W * 0.5);
    const rule = Buffer.from(
      `<svg width="${ruleW}" height="4" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="${ruleW}" height="4" rx="2" fill="${cyan}"/></svg>`,
    );
    composites.push({ input: rule, left: Math.round((W - ruleW) / 2), top: logoTop - Math.round(H * 0.018) });
  }

  return sharp(base).composite(composites).png().toBuffer();
}
