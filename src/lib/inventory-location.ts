// ---------------------------------------------------------------------------
// inventory-location.ts — where a stick physically is.
//
// Consignment stock lives at a retailer but is still Tilt's until it sells, so
// "who owns it" and "where is it" stopped being the same question the day the
// Faust deal was agreed. The sheet only knew Available / Sold / In Production,
// which answers ownership and says nothing about the shelf it's sitting on.
//
// A Location column answers it without disturbing anything: a consigned stick
// stays Available — that's the point, the retailer sells it — and the location
// says which building to walk into.
//
// Blank means Tilt HQ. That's the default for 745 existing rows, and writing
// "Tilt HQ" into every one of them would be 745 API calls to say what silence
// already says. Every read normalises, so nothing downstream sees the blank.
// ---------------------------------------------------------------------------
import type { StickRecord } from "./zoho-sheet";

/** The column as it must appear in the sheet's header row. */
export const LOCATION_COLUMN = "Location";

/** Where stock sits when nobody has said otherwise. */
export const TILT_HQ = "Tilt HQ";

/**
 * Places Tilt currently keeps stock. Free text is still accepted — a new
 * retailer shouldn't need a deploy — but these spell consistently, and a
 * location typed three ways is three locations to anything grouping by it.
 */
export const KNOWN_LOCATIONS = [
  TILT_HQ,
  "Faust Home Hardware",
  "Sports Excellence",
] as const;

/** Blank, missing or whitespace all mean the sticks are at Tilt. */
export function normalizeLocation(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return TILT_HQ;
  // Match a known location case-insensitively so "faust home hardware" and
  // "Faust Home Hardware" don't split into two places on a report.
  const known = KNOWN_LOCATIONS.find(
    (k) => k.toLowerCase() === v.toLowerCase()
  );
  return known ?? v;
}

/** True when this stick is out on consignment rather than at Tilt. */
export function isAtRetailer(raw: string | null | undefined): boolean {
  return normalizeLocation(raw) !== TILT_HQ;
}

export interface LocationChange {
  serial: string;
  /** Where the sheet says it is now. */
  from: string;
  /** Where it will say after the push. */
  to: string;
  tab: string;
  rowIndex: number;
  level: string;
  size: number;
  status: string;
}

export interface LocationPlan {
  /** Rows that will actually be written. */
  changes: LocationChange[];
  /** Already at that location — nothing to do, and nothing written. */
  unchanged: LocationChange[];
  /** Serials with no row on the sheet. Named, never silently dropped. */
  notFound: string[];
  /** Counted twice in the input. */
  duplicates: string[];
  /** Rows that aren't physical sticks yet, so a location is meaningless. */
  notYetBuilt: string[];
  /** Already sold. Moving a sold stick's location is almost always a mistake,
   *  so it's separated out rather than written along with the rest. */
  alreadySold: LocationChange[];
}

function isSold(status: string): boolean {
  return String(status ?? "").trim().toLowerCase() === "sold";
}

function isNotYetBuilt(r: StickRecord): boolean {
  const serial = String(r.serial_number ?? "").trim().toUpperCase();
  const status = String(r.status ?? "").trim().toLowerCase();
  return !serial || serial.startsWith("PROD-") || status === "in production";
}

/**
 * Work out exactly which rows a location change would touch.
 *
 * Pure, and separate from the write, because this is the thing a human should
 * be able to read before pressing a button that edits the master sheet.
 */
export function planLocationChange(
  records: StickRecord[],
  serials: string[],
  location: string,
  matchKey: (s: string) => string
): LocationPlan {
  const target = normalizeLocation(location);

  const bySerial = new Map<string, StickRecord>();
  for (const r of records) {
    const k = matchKey(r.serial_number);
    if (k && !bySerial.has(k)) bySerial.set(k, r);
  }

  const plan: LocationPlan = {
    changes: [],
    unchanged: [],
    notFound: [],
    duplicates: [],
    notYetBuilt: [],
    alreadySold: [],
  };
  const seen = new Set<string>();

  for (const raw of serials) {
    const serial = String(raw ?? "").trim();
    if (!serial) continue;
    const k = matchKey(serial);
    if (!k) continue;
    if (seen.has(k)) {
      plan.duplicates.push(serial);
      continue;
    }
    seen.add(k);

    const record = bySerial.get(k);
    if (!record) {
      plan.notFound.push(serial);
      continue;
    }
    if (isNotYetBuilt(record)) {
      plan.notYetBuilt.push(serial);
      continue;
    }

    const from = normalizeLocation(record.location);
    const change: LocationChange = {
      serial: record.serial_number,
      from,
      to: target,
      tab: record.tab,
      rowIndex: record.row_index,
      level: record.level,
      size: record.size,
      status: record.status,
    };

    if (isSold(record.status)) plan.alreadySold.push(change);
    else if (from === target) plan.unchanged.push(change);
    else plan.changes.push(change);
  }

  return plan;
}

/** A one-line summary of a plan, in the terms a human would check it in. */
export function describePlan(plan: LocationPlan): string {
  const bits = [`${plan.changes.length} to move`];
  if (plan.unchanged.length) bits.push(`${plan.unchanged.length} already there`);
  if (plan.alreadySold.length) bits.push(`${plan.alreadySold.length} already sold`);
  if (plan.notYetBuilt.length) bits.push(`${plan.notYetBuilt.length} not built yet`);
  if (plan.notFound.length) bits.push(`${plan.notFound.length} not on the sheet`);
  if (plan.duplicates.length) bits.push(`${plan.duplicates.length} listed twice`);
  return bits.join(" · ");
}
