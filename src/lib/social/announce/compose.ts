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
 * Sample the color the logo actually lives on — the border pixels of the
 * (already trimmed) upload — so the card behind it can match instead of
 * forcing white. A mark drawn on black gets a black card; a transparent PNG
 * keeps the classic white card.
 */
export async function logoCardFill(trimmedLogo: Buffer): Promise<string> {
  try {
    const { data, info } = await sharp(trimmedLogo)
      .resize(48, 48, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const coords: Array<[number, number]> = [];
    for (let x = 0; x < info.width; x++) coords.push([x, 0], [x, info.height - 1]);
    for (let y = 1; y < info.height - 1; y++) coords.push([0, y], [info.width - 1, y]);
    // Modal bucket, not a plain average: border pixels that touch the mark
    // itself would tint the card (white bg + blue logo → bluish card). The
    // dominant coarse color bucket wins; its own average is the fill.
    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
    let opaque = 0, transparent = 0;
    for (const [x, y] of coords) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] < 32) { transparent++; continue; }
      opaque++;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const bk = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      bk.r += data[i]; bk.g += data[i + 1]; bk.b += data[i + 2]; bk.n++;
      buckets.set(key, bk);
    }
    // A mark that floats on transparency has no background of its own — the
    // white card stays, matching how these logos ship on light collateral.
    if (!opaque || transparent > opaque) return "#ffffff";
    const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    const hex = (v: number) => Math.round(v / top.n).toString(16).padStart(2, "0");
    return `#${hex(top.r)}${hex(top.g)}${hex(top.b)}`;
  } catch {
    return "#ffffff";
  }
}

function relLuminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/**
 * Rounded card in the logo's own background color (sampled by logoCardFill)
 * with the trimmed+fitted logo centered in it. When a partner accent color is
 * set, the card gets a border in that color — the one consistent place partner
 * colors appear on the layout. Dark cards get a faint hairline instead so they
 * still read as a card against the dark canvas.
 */
function cardFor(
  lw: number,
  lh: number,
  accent?: string | null,
  fill = "#ffffff",
): { svg: Buffer; w: number; h: number; pad: number } {
  // Generous padding: trimLogo strips the logo's own margins, so the card has
  // to give them back — a tight card reads as the mark blown up to fit.
  const pad = Math.round(Math.max(lw, lh) * 0.24);
  const w = lw + pad * 2;
  const h = lh + pad * 2;
  const rx = Math.round(pad * 1.2);
  let stroke = "";
  if (accent) {
    const sw = Math.max(5, Math.round(pad * 0.3));
    stroke = `<rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" rx="${rx}" fill="none" stroke="${accent}" stroke-width="${sw}"/>`;
  } else if (relLuminance(fill) < 80) {
    stroke = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${rx}" fill="none" stroke="#3d434b" stroke-width="2"/>`;
  }
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>${stroke}</svg>`,
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

// ---------------------------------------------------------------------------
// AMBASSADOR graphic — deterministic, code-composited, same rationale as the
// partner card: the image model kept drifting (wrong blues, invented TILT
// wordmarks, and in one case an entirely invented player). Now the REAL photo
// is placed untouched in a framed panel, every word is typeset in code in the
// exact brand cyan, and the TILT marks are stamped as fixed overlays. The only
// AI involvement is an optional, verified competitor-logo blur on the photo
// (see blurCompetitorMarks in generate.ts) BEFORE it reaches this composer.
// ---------------------------------------------------------------------------

export type AmbassadorGraphicInput = {
  /** Player name — typeset huge, stacked into lines. */
  name: string;
  /** Team / location line under the name (optional). */
  subtitle?: string | null;
  /** The player's REAL photo bytes — shown as-is, never regenerated. */
  photo: Buffer;
  width?: number;
  height?: number;
};

/** Diagonal brushed-silver ribbons across the top-left + bottom-right corners. */
function ribbonSvg(W: number, H: number): Buffer {
  const t = Math.round(W * 0.045);
  const c1 = Math.round(W * 0.22);
  const c2 = Math.round(W * 0.26);
  return Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#eef1f4"/>` +
      `<stop offset="0.45" stop-color="#8d949c"/>` +
      `<stop offset="0.7" stop-color="#d9dde2"/>` +
      `<stop offset="1" stop-color="#f4f6f8"/>` +
      `</linearGradient></defs>` +
      `<polygon points="0,${c1} ${c1},0 ${c1 + t},0 0,${c1 + t}" fill="url(#metal)"/>` +
      `<polygon points="${W},${H - c2} ${W - c2},${H} ${W - c2 - t},${H} ${W},${H - c2 - t}" fill="url(#metal)"/>` +
      `</svg>`,
  );
}

/** Stack a name into 1–3 display lines (greedy word packing, ~12 chars/line). */
function nameLines(name: string): string[] {
  const words = name.toUpperCase().trim().split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + w).length <= 12) {
      lines[lines.length - 1] = `${last} ${w}`;
    } else {
      lines.push(w);
    }
  }
  return lines.slice(0, 3);
}

export async function composeAmbassadorGraphic(
  input: AmbassadorGraphicInput,
): Promise<Buffer> {
  const W = input.width ?? 1080;
  const H = input.height ?? 1350;
  const cyan = BRAND.colors.cyan;

  const base = await sharp(Buffer.from(backgroundSvg(W, H))).png().toBuffer();
  const composites: sharp.OverlayOptions[] = [
    { input: Buffer.from(checkerSvg(W, H)), left: 0, top: 0 },
    { input: ribbonSvg(W, H), left: 0, top: 0 },
  ];

  // --- Top: TILT wordmark on a dark plate (same treatment as before). ---
  const logo = await loadLogo();
  let contentTop = Math.round(H * 0.13);
  if (logo) {
    const logoW = Math.round(W * 0.42);
    const logoBuf = await sharp(logo, { density: 300 }).resize({ width: logoW }).png().toBuffer();
    const meta = await sharp(logoBuf).metadata();
    const logoH = meta.height ?? Math.round(logoW / 8);
    const padX = Math.round(logoW * 0.12);
    const padY = Math.round(logoH * 0.55);
    const plateW = logoW + padX * 2;
    const plateH = logoH + padY * 2;
    const plateTop = Math.round(H * 0.025);
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
    contentTop = plateTop + plateH + Math.round(H * 0.02);
  }

  // --- Bottom: soft scrim with the T-shield over a small wordmark. ---
  const band = Math.round(H * 0.16);
  composites.push({
    input: Buffer.from(
      `<svg width="${W}" height="${band}" xmlns="http://www.w3.org/2000/svg">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${BRAND.colors.black}" stop-opacity="0"/>` +
        `<stop offset="1" stop-color="${BRAND.colors.black}" stop-opacity="0.85"/>` +
        `</linearGradient></defs>` +
        `<rect width="${W}" height="${band}" fill="url(#g)"/></svg>`,
    ),
    left: 0,
    top: H - band,
  });
  const shield = await loadShield();
  let cursorY = H - band + Math.round(band * 0.2);
  if (shield) {
    const shieldW = Math.round(W * 0.085);
    const shieldBuf = await sharp(shield, { density: 300 }).resize({ width: shieldW }).png().toBuffer();
    const sMeta = await sharp(shieldBuf).metadata();
    composites.push({
      input: shieldBuf,
      left: Math.round((W - shieldW) / 2),
      top: cursorY,
    });
    cursorY += (sMeta.height ?? shieldW) + Math.round(H * 0.012);
  }
  if (logo) {
    const wmW = Math.round(W * 0.24);
    const wmBuf = await sharp(logo, { density: 300 }).resize({ width: wmW }).png().toBuffer();
    const wmMeta = await sharp(wmBuf).metadata();
    const wmH = wmMeta.height ?? Math.round(wmW / 8);
    composites.push({
      input: wmBuf,
      left: Math.round((W - wmW) / 2),
      top: Math.min(cursorY, H - wmH - Math.round(H * 0.02)),
    });
  }

  // --- Left: the REAL photo in a rounded panel, attention-cropped, framed. ---
  const photoLeft = Math.round(W * 0.05);
  const photoTop = contentTop;
  const photoW = Math.round(W * 0.45);
  const photoH = H - band - photoTop - Math.round(H * 0.015);
  const rx = 18;
  const photoFit = await sharp(input.photo)
    .rotate() // respect EXIF orientation from phone uploads
    .resize(photoW, photoH, { fit: "cover", position: "attention" })
    .png()
    .toBuffer();
  const rounded = await sharp(photoFit)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${photoW}" height="${photoH}" xmlns="http://www.w3.org/2000/svg">` +
            `<rect width="${photoW}" height="${photoH}" rx="${rx}" fill="#ffffff"/></svg>`,
        ),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  const photoShadow = shadowFor(photoW, photoH, rx);
  composites.push({
    input: photoShadow.svg,
    left: photoLeft - photoShadow.margin,
    top: photoTop - photoShadow.margin + Math.round(photoH * 0.02),
  });
  composites.push({ input: rounded, left: photoLeft, top: photoTop });
  composites.push({
    input: Buffer.from(
      `<svg width="${photoW}" height="${photoH}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="1.5" y="1.5" width="${photoW - 3}" height="${photoH - 3}" rx="${rx}" fill="none" stroke="#c9ced6" stroke-width="3"/>` +
        `<rect x="1.5" y="1.5" width="${photoW - 3}" height="6" rx="3" fill="${cyan}"/></svg>`,
    ),
    left: photoLeft,
    top: photoTop,
  });

  // --- Right: the text column, every word typeset in exact brand color. ---
  const colLeft = photoLeft + photoW + Math.round(W * 0.035);
  const colRight = W - Math.round(W * 0.05);
  const colW = colRight - colLeft;
  const cx = colLeft + Math.round(colW / 2);
  const texts: string[] = [];

  let y = photoTop + Math.round(H * 0.035);

  // WELCOME / TO THE TEAM
  const h1 = fitFont("WELCOME", colW, Math.round(W * 0.075), 0.62);
  y += h1;
  texts.push(
    `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${h1}" letter-spacing="2" fill="#ffffff">WELCOME</text>`,
  );
  const h2 = fitFont("TO THE TEAM", colW, Math.round(W * 0.058), 0.62);
  y += Math.round(h2 * 1.25);
  texts.push(
    `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${h2}" letter-spacing="2" fill="${cyan}">TO THE TEAM</text>`,
  );

  // Player name, stacked, inside a thin silver outline.
  const lines = nameLines(input.name);
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
  const nf = fitFont(longest, Math.round(colW * 0.84), Math.round(W * 0.085), 0.6);
  const nameLineH = Math.round(nf * 1.08);
  const namePad = Math.round(nf * 0.42);
  const boxTop = y + Math.round(H * 0.028);
  const boxH = namePad * 2 + nameLineH * lines.length;
  texts.push(
    `<rect x="${colLeft + Math.round(colW * 0.02)}" y="${boxTop}" width="${Math.round(colW * 0.96)}" height="${boxH}" fill="none" stroke="#c9ced6" stroke-width="2.5"/>`,
  );
  let ny = boxTop + namePad + Math.round(nf * 0.82);
  for (const ln of lines) {
    texts.push(
      `<text x="${cx}" y="${ny}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${nf}" letter-spacing="1.5" fill="#ffffff">${xmlEscape(ln)}</text>`,
    );
    ny += nameLineH;
  }
  y = boxTop + boxH;

  // Team / location subtitle.
  const subtitle = input.subtitle?.trim();
  if (subtitle) {
    const sf = fitFont(subtitle.toUpperCase(), Math.round(colW * 0.94), Math.round(W * 0.03), 0.56);
    y += Math.round(H * 0.026) + sf;
    texts.push(
      `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${sf}" letter-spacing="2" fill="#ffffff">${xmlEscape(subtitle.toUpperCase())}</text>`,
    );
  }

  // "You're officially part of the" / TILT AMBASSADOR CLUB / subline.
  const pf = Math.round(W * 0.026);
  y += Math.round(H * 0.035) + pf;
  texts.push(
    `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="500" font-size="${pf}" fill="#e8eaed">You&apos;re officially part of the</text>`,
  );
  const cf = fitFont("TILT AMBASSADOR CLUB", colW, Math.round(W * 0.042), 0.6);
  y += Math.round(cf * 1.35);
  texts.push(
    `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${cf}" letter-spacing="1" fill="${cyan}">TILT AMBASSADOR CLUB</text>`,
  );
  const slf = Math.round(W * 0.023);
  const slLines = wrapLines(
    "The ultimate squad for young hockey stars and future legends.",
    Math.floor((colW * 0.95) / (slf * 0.47)),
  ).slice(0, 3);
  y += Math.round(H * 0.012);
  for (const ln of slLines) {
    y += Math.round(slf * 1.4);
    texts.push(
      `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="500" font-size="${slf}" fill="#d7dbe0">${xmlEscape(ln)}</text>`,
    );
  }

  // "— TEAM TILT" sign-off (plain text, never a logo).
  const tf = Math.round(W * 0.026);
  y += Math.round(H * 0.032) + tf;
  texts.push(
    `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${tf}" letter-spacing="3" fill="#ffffff">&#8212; TEAM TILT</text>`,
  );

  composites.push({
    input: Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${texts.join("")}</svg>`,
    ),
    left: 0,
    top: 0,
  });

  return sharp(base).composite(composites).png().toBuffer();
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
  const trimmed = await trimLogo(input.partnerLogo);
  const cardFill = await logoCardFill(trimmed);
  const logoFit = await sharp(trimmed)
    .resize(Math.round(maxW * 0.82), Math.round(maxH * 0.82), { fit: "inside" })
    .png()
    .toBuffer();
  const lmeta = await sharp(logoFit).metadata();
  const lw = lmeta.width ?? maxW;
  const lh = lmeta.height ?? maxH;
  const card = cardFor(lw, lh, accent, cardFill);

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
