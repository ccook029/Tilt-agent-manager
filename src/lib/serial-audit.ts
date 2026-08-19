// ---------------------------------------------------------------------------
// serial-audit.ts — reconcile a physical serial count against the live sheet.
//
// Somebody walks the racks, reads the label off every stick, and ends up with a
// list of serials. This answers the only three questions that list can settle:
//
//   1. What ARE these? The labels carry no specs. The sheet has them.
//   2. What's here that the sheet doesn't know about? Untracked stock — it
//      can't be sold, because nothing lists it.
//   3. What does the sheet think is here that isn't? Either it walked out the
//      door unrecorded, or it's listed for sale right now and can't be shipped.
//
// The third is the expensive one, and it's silent: a stick that's gone still
// looks perfectly fine on a shelf report. Nobody finds out until an order comes
// in for it.
// ---------------------------------------------------------------------------
import type { StickRecord } from "./zoho-sheet";
// From serial-format, not from the intake/pre-order modules that re-export
// them: this file runs in the browser, and those pull in Anthropic and KV.
import { normalizeSerial, PREORDER_PREFIX } from "./serial-format";

/**
 * The comparison key for two serials that name the same stick.
 *
 * Distinct from `normalizeSerial`, deliberately. That one produces the serial
 * as it should be STORED — faithful to the label, because scanning the label is
 * how a stick gets looked up. This one produces a key for COMPARING, and it
 * folds together forms that are printed differently but mean the same batch.
 *
 * The factory has used two date formats. Most labels are `H2607-09684` —
 * letter, YYMM, sequence. The April/May 2026 Prospect runs came back as
 * `H202604-05359`, the same date written YYYYMM. Compared literally, every one
 * of those sticks reads as missing from the sheet and present in the count at
 * the same time — ten fake discrepancies out of sixty-five, which is enough
 * noise to make somebody stop trusting the whole report.
 */
export function serialKey(raw: string): string {
  const compact = String(raw ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    // A label reads `H2312.01020` about as often as `H2312-01020`; the
    // separator is whatever the printer felt like that day.
    .replace(/[._/\\]/g, "-")
    .replace(/[^A-Z0-9-]/g, "");
  if (!compact) return "";

  // H202604-05359 → H2604-05359. Only when the century digits are actually
  // there and what's left is a real month, so a genuinely different numbering
  // scheme isn't quietly mangled into a collision.
  const wide = compact.match(/^([A-Z])20(\d{2})(\d{2})-?(\d{3,6})$/);
  if (wide) {
    const month = Number(wide[3]);
    if (month >= 1 && month <= 12) return `${wide[1]}${wide[2]}${wide[3]}-${wide[4]}`;
  }

  return normalizeSerial(compact);
}

export interface ParsedSerial {
  /** Batch prefix as printed, e.g. `H2607` or `H202604`. */
  prefix: string;
  /** Sequence within the batch, as printed (leading zeros kept). */
  sequence: string;
  /** `2026-07`, or "" when the prefix isn't a date code we recognise. */
  batchMonth: string;
  /** How the label was written — the 7-char form is the factory's outlier. */
  format: "standard" | "wide-date" | "unknown";
}

/** Pull the batch and sequence out of a serial. Never throws. */
export function parseSerial(raw: string): ParsedSerial {
  const compact = String(raw ?? "").toUpperCase().replace(/\s+/g, "").replace(/[._/\\]/g, "-");

  const wide = compact.match(/^([A-Z]20(\d{2})(\d{2}))-?(\d{3,6})$/);
  if (wide && Number(wide[3]) >= 1 && Number(wide[3]) <= 12) {
    return {
      prefix: wide[1],
      sequence: wide[4],
      batchMonth: `20${wide[2]}-${wide[3]}`,
      format: "wide-date",
    };
  }

  const std = compact.match(/^([A-Z](\d{2})(\d{2}))-?(\d{3,6})$/);
  if (std && Number(std[3]) >= 1 && Number(std[3]) <= 12) {
    return {
      prefix: std[1],
      sequence: std[4],
      batchMonth: `20${std[2]}-${std[3]}`,
      format: "standard",
    };
  }

  const loose = compact.match(/^([A-Z0-9]+)-(\d+)$/);
  if (loose) {
    return { prefix: loose[1], sequence: loose[2], batchMonth: "", format: "unknown" };
  }

  return { prefix: compact, sequence: "", batchMonth: "", format: "unknown" };
}

/** One line of the physical count. */
export interface CountedSerial {
  serial: string;
  /** Anything the counter wrote down — "photo blur, re-verify" and the like. */
  note?: string;
}

export interface MatchedStick extends ParsedSerial {
  /** The serial as counted, not as normalised — this is what's on the label. */
  serial: string;
  note: string;
  record: StickRecord;
}

export interface UnmatchedSerial extends ParsedSerial {
  serial: string;
  note: string;
}

export interface MissingStick {
  record: StickRecord;
  /** Why this matters right now, in the sheet's own terms. */
  status: string;
}

export interface SerialAudit {
  /** Counted, found on the sheet — the specs, which is the point of the count. */
  matched: MatchedStick[];
  /** Counted, no row anywhere. Untracked: real stock nobody can buy. */
  notOnSheet: UnmatchedSerial[];
  /** Counted, but the sheet already sold it. Either a bad sale record or an
   *  unshipped order sitting on the rack. */
  soldButPresent: MatchedStick[];
  /** The sheet says it's on hand and it wasn't counted. Listed for sale,
   *  nowhere to be found. */
  missingFromCount: MissingStick[];
  /** Counted twice — the same stick read from two racks, or a duplicated row. */
  duplicatesInCount: string[];
  summary: {
    counted: number;
    matched: number;
    notOnSheet: number;
    soldButPresent: number;
    missingFromCount: number;
    /** Sheet rows the count can say nothing about: still at the factory. */
    skippedNotYetBuilt: number;
  };
}

/** A row that isn't a physical stick yet, so a floor count can't contradict it. */
function isNotYetBuilt(r: StickRecord): boolean {
  const serial = String(r.serial_number ?? "").trim().toUpperCase();
  const status = String(r.status ?? "").trim().toLowerCase();
  return serial.startsWith(PREORDER_PREFIX) || !serial || status === "in production";
}

function isSold(r: StickRecord): boolean {
  return String(r.status ?? "").trim().toLowerCase() === "sold";
}

/**
 * Reconcile a physical count against the sheet.
 *
 * `records` is expected to be every row across every tab — pass a partial sheet
 * and everything absent from it lands in `notOnSheet`, which reads as a
 * catastrophe rather than a short read.
 */
export function auditSerials(
  counted: CountedSerial[],
  records: StickRecord[]
): SerialAudit {
  const byKey = new Map<string, StickRecord>();
  for (const r of records) {
    const key = serialKey(r.serial_number);
    // Skip placeholders: PROD-0042 keys to itself and would otherwise claim to
    // be a stick somebody could have counted.
    if (!key || isNotYetBuilt(r)) continue;
    if (!byKey.has(key)) byKey.set(key, r);
  }

  const matched: MatchedStick[] = [];
  const notOnSheet: UnmatchedSerial[] = [];
  const soldButPresent: MatchedStick[] = [];
  const duplicatesInCount: string[] = [];
  const seen = new Set<string>();
  const claimed = new Set<string>();

  for (const c of counted) {
    const serial = String(c.serial ?? "").trim();
    if (!serial) continue;
    const key = serialKey(serial);
    if (!key) continue;

    if (seen.has(key)) {
      duplicatesInCount.push(serial);
      continue;
    }
    seen.add(key);

    const parsed = parseSerial(serial);
    const record = byKey.get(key);
    const note = String(c.note ?? "").trim();

    if (!record) {
      notOnSheet.push({ serial, note, ...parsed });
      continue;
    }

    claimed.add(key);
    const hit: MatchedStick = { serial, note, record, ...parsed };
    matched.push(hit);
    if (isSold(record)) soldButPresent.push(hit);
  }

  const missingFromCount: MissingStick[] = [];
  let skippedNotYetBuilt = 0;
  for (const r of records) {
    if (isNotYetBuilt(r)) {
      skippedNotYetBuilt++;
      continue;
    }
    const key = serialKey(r.serial_number);
    if (!key || claimed.has(key)) continue;
    // A sold stick that wasn't on the rack is the system working.
    if (isSold(r)) continue;
    missingFromCount.push({ record: r, status: String(r.status ?? "").trim() });
  }

  return {
    matched,
    notOnSheet,
    soldButPresent,
    missingFromCount,
    duplicatesInCount,
    summary: {
      counted: seen.size,
      matched: matched.length,
      notOnSheet: notOnSheet.length,
      soldButPresent: soldButPresent.length,
      missingFromCount: missingFromCount.length,
      skippedNotYetBuilt,
    },
  };
}

/** Batch rollup of a count, for the summary tab of the export. */
export interface BatchLine {
  prefix: string;
  batchMonth: string;
  format: ParsedSerial["format"];
  count: number;
  matched: number;
  sequenceRange: string;
}

export function batchSummary(counted: CountedSerial[], audit: SerialAudit): BatchLine[] {
  const matchedKeys = new Set(audit.matched.map((m) => serialKey(m.serial)));
  const groups = new Map<string, { line: BatchLine; sequences: string[] }>();

  for (const c of counted) {
    const serial = String(c.serial ?? "").trim();
    if (!serial) continue;
    const p = parseSerial(serial);
    const g = groups.get(p.prefix) ?? {
      line: {
        prefix: p.prefix,
        batchMonth: p.batchMonth,
        format: p.format,
        count: 0,
        matched: 0,
        sequenceRange: "",
      },
      sequences: [],
    };
    g.line.count++;
    if (matchedKeys.has(serialKey(serial))) g.line.matched++;
    if (p.sequence) g.sequences.push(p.sequence);
    groups.set(p.prefix, g);
  }

  return [...groups.values()]
    .map(({ line, sequences }) => {
      const sorted = [...sequences].sort();
      line.sequenceRange =
        sorted.length === 0
          ? ""
          : sorted.length === 1
            ? sorted[0]
            : `${sorted[0]} – ${sorted[sorted.length - 1]}`;
      return line;
    })
    .sort((a, b) => (a.batchMonth || a.prefix).localeCompare(b.batchMonth || b.prefix));
}

/**
 * Pull the count out of an uploaded sheet.
 *
 * A count arrives as whatever the person doing it made: a register with a
 * "Full Serial" column, a phone export with one bare column, a photo log with
 * the serial third from the left. So the header is found rather than assumed,
 * and if there's no header worth finding, every cell that looks like a serial
 * is taken. Guessing a column index would silently audit the wrong column.
 */
export function serialsFromGrid(grid: (string | number | null | undefined)[][]): CountedSerial[] {
  const cell = (v: unknown) => String(v ?? "").trim();
  const looksLikeSerial = (v: string) => /^[A-Za-z]\d{4,6}[-._ ]?\d{3,6}$/.test(v);

  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const row = (grid[r] ?? []).map(cell);
    // "Full Serial" beats a bare "Serial" when a sheet has both.
    let serialCol = row.findIndex((h) => /full\s*serial/i.test(h));
    if (serialCol < 0) serialCol = row.findIndex((h) => /serial/i.test(h));
    if (serialCol < 0) continue;
    const noteCol = row.findIndex((h) => /flag|note|comment/i.test(h));

    const out: CountedSerial[] = [];
    for (const raw of grid.slice(r + 1)) {
      const serial = cell((raw ?? [])[serialCol]);
      if (!serial || !looksLikeSerial(serial)) continue;
      const note = noteCol >= 0 ? cell((raw ?? [])[noteCol]) : "";
      out.push(note ? { serial, note } : { serial });
    }
    if (out.length > 0) return out;
  }

  // No usable header — take anything shaped like a serial, in reading order.
  const out: CountedSerial[] = [];
  for (const row of grid) {
    for (const v of row ?? []) {
      const s = cell(v);
      if (looksLikeSerial(s)) out.push({ serial: s });
    }
  }
  return out;
}

/**
 * Read a pasted count into serials.
 *
 * Accepts one per line, or a line with a trailing note after a comma or tab —
 * whatever comes out of a phone note or a pasted spreadsheet column.
 */
export function parseCountInput(text: string): CountedSerial[] {
  const out: CountedSerial[] = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/[\t,]/);
    const serial = parts[0].trim();
    if (!serial) continue;
    // Skip an obvious header row rather than reporting "SERIAL" as missing stock.
    if (/^(serial|full serial|serial number|#)$/i.test(serial)) continue;
    const note = parts.slice(1).join(", ").trim();
    out.push(note ? { serial, note } : { serial });
  }
  return out;
}
