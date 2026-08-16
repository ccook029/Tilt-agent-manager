// ---------------------------------------------------------------------------
// sticks-sold.ts — how many sticks actually sold in a date range.
//
// This used to be counted from invoice line items, which was wrong twice over.
// Zoho Books' invoice LIST endpoint doesn't return line items at all, so the
// count was permanently 0; and fetching each invoice's detail to fix that meant
// hundreds of API calls behind a 60-second route, which timed out and took the
// whole metrics panel down with it.
//
// The inventory sheet already knows. Every stick is one row, a sale sets Status
// to Sold and stamps Date Sold, and that's the same record the storefront and
// the retail flow both write. One read, no line items, and it counts STICKS
// rather than SKUs — which is what the tile claims to show.
// ---------------------------------------------------------------------------
import type { StickRecord } from "./zoho-sheet";

/** Sold, in the sheet's own words. Case and spacing vary by who typed it. */
function isSold(status: string): boolean {
  return String(status ?? "").trim().toLowerCase() === "sold";
}

/**
 * A sold date as a YYYYMMDD integer, or null if it can't be read.
 *
 * The storefront writes ISO (`2026-08-14`), but this column has been typed by
 * hand for years, so the common hand-written shapes are accepted too. Anything
 * ambiguous is refused rather than guessed: counting a stick into the wrong
 * month is worse than admitting the date is unreadable, and the caller reports
 * how many were refused so a sheet full of bad dates can't quietly deflate the
 * number.
 */
export function parseSoldDate(raw: string): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;

  // 2026-08-14 or 2026/08/14
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v);
  if (iso) return toDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // 14-08-2026 or 08/14/2026 — only resolvable when one part is > 12.
  const slashed = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(v);
  if (slashed) {
    const a = Number(slashed[1]);
    const b = Number(slashed[2]);
    const year = Number(slashed[3]);
    if (a > 12 && b <= 12) return toDay(year, b, a); // D/M/Y
    if (b > 12 && a <= 12) return toDay(year, a, b); // M/D/Y
    return null; // genuinely ambiguous — don't guess a month
  }

  return null;
}

function toDay(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return year * 10000 + month * 100 + day;
}

/** "2026-08-14" → 20260814, for range ends supplied by the caller. */
export function dayFromIso(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  return m ? toDay(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

export interface StickSalesCount {
  /** Sticks sold in the range. */
  count: number;
  /** Sold rows whose date couldn't be read, so they're in no month at all.
   *  Surfaced rather than swallowed — a large number here means the count is
   *  a floor, not a fact. */
  unreadableDates: number;
}

/**
 * Count sold sticks between two ISO dates, inclusive at both ends.
 */
export function countSticksSold(
  records: StickRecord[],
  startIso: string,
  endIso: string
): StickSalesCount {
  const from = dayFromIso(startIso);
  const to = dayFromIso(endIso);
  if (from === null || to === null) return { count: 0, unreadableDates: 0 };

  let count = 0;
  let unreadableDates = 0;
  for (const r of records) {
    if (!isSold(r.status)) continue;
    const sold = parseSoldDate(r.date_sold);
    if (sold === null) {
      unreadableDates++;
      continue;
    }
    if (sold >= from && sold <= to) count++;
  }
  return { count, unreadableDates };
}
