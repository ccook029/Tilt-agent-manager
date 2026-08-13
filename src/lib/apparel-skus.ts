// ---------------------------------------------------------------------------
// apparel-skus.ts — the one SKU convention for apparel variants.
//
// Apparel used to reach Zoho with no SKU at all ("mapping TBD"), so hoodie
// sales never touched stock. Fixing that means the storefront and Zoho have to
// agree on a SKU for every colour/size combination, forever. The rule is
// deterministic and derived from data both sides already have, so neither can
// drift from the other by editing a list.
//
//   TILT-{PRODUCT}-{COLOUR}-{SIZE}     e.g. TILT-HOOD-CTN-BLK-M
//
// This file is mirrored in tiltweb (src/lib/apparel-skus.ts). If the rule
// changes, both move together or orders stop matching stock.
// ---------------------------------------------------------------------------

/**
 * Storefront product id → the SKU's product segment.
 *
 * The ids are internal and outlive display names — "tilt-custom-hoodie" is
 * the Performance Tech Hoodie. Renaming the product does not change its id,
 * because the id is what past orders and cart entries are keyed on.
 */
export const APPAREL_PRODUCT_CODES: Record<string, string> = {
  "tilt-cotton-hoodie": "HOOD-CTN",
  "tilt-custom-hoodie": "HOOD-PERF",
};

/** Colour names as they appear in the storefront → SKU segment. */
export const COLOUR_CODES: Record<string, string> = {
  Black: "BLK",
  Grey: "GRY",
  Gray: "GRY",
  Navy: "NVY",
  White: "WHT",
  Red: "RED",
  Blue: "BLU",
  Green: "GRN",
  Gold: "GLD",
};

/**
 * Fallback for a colour with no explicit code: first three letters, uppercase.
 * Keeps a new colour from silently producing an empty segment — a readable
 * guess beats a malformed SKU, and the explicit map above is where it gets
 * pinned down properly.
 */
export function colourCode(colour: string): string {
  const trimmed = colour.trim();
  if (!trimmed) return "";
  return COLOUR_CODES[trimmed] ?? trimmed.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();
}

/** Sizes are already short codes (YS, M, XXL) — normalize case only. */
export function sizeCode(size: string): string {
  return size.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * Build the variant SKU. Returns undefined when the product isn't one of the
 * mapped apparel products, or when colour/size are missing — callers must
 * treat that as "no SKU" rather than inventing one, so an unmapped product
 * fails visibly instead of colliding with a real SKU.
 */
export function apparelSku(
  productId: string,
  colour: string | undefined,
  size: string | undefined
): string | undefined {
  const product = APPAREL_PRODUCT_CODES[productId];
  if (!product) return undefined;
  const c = colourCode(colour ?? "");
  const s = sizeCode(size ?? "");
  if (!c || !s) return undefined;
  return `TILT-${product}-${c}-${s}`;
}
