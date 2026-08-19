// ---------------------------------------------------------------------------
// serial-format.ts — what a Tilt serial looks like. Nothing else.
//
// This is deliberately dependency-free. The same two rules are needed by the
// intake pipeline (server, Zoho + Anthropic), the pre-order writer (server, KV)
// and the serial-audit screen (browser). They used to live in the first of
// those, which meant importing the Anthropic SDK into the browser to find out
// whether two serials were the same stick — and the build said so.
//
// Both are re-exported from their original homes, so existing imports are
// unchanged; this file is just where the definition lives now.
// ---------------------------------------------------------------------------

/**
 * The serial as it should be STORED — faithful to the printed label.
 *
 * Scanning the label is how a stick gets found, so what goes in the sheet has
 * to be what's on the stick. Only genuine typing noise is cleaned up: case,
 * spaces, and a dash the printer dropped.
 */
export function normalizeSerial(raw: string): string {
  const compact = String(raw ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
  if (!compact) return "";
  // H2607-09904 shape: letter, 4 digits, dash, 5 digits. Re-insert a missing
  // dash rather than treating the row as a different stick.
  const m = compact.match(/^([A-Z])(\d{4})-?(\d{4,6})$/);
  return m ? `${m[1]}${m[2]}-${m[3]}` : compact;
}

/**
 * Marks a sheet row as a stick that doesn't exist yet: a pre-order holding its
 * place until the real serial arrives from the factory.
 */
export const PREORDER_PREFIX = "PROD-";
