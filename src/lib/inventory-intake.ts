// ---------------------------------------------------------------------------
// inventory-intake.ts — turn a received-stock spreadsheet into inventory rows.
//
// Stock arrives as a workbook someone typed by hand: merged headers split over
// two rows, "Box 2" separators mid-table, a custom-order section further down,
// goalie sticks in their own block, and serials with stray spaces or missing
// dashes. No fixed schema survives that, and there is no reason it should —
// the point of this is that the sheet does not have to change shape.
//
// Division of labour:
//   - Stockton (the model) reads the grid and works out the column mapping,
//     where the stock section ends, and which rows are custom builds.
//   - Code does everything a wrong answer would corrupt: serial normalisation,
//     dedupe against the live sheet, and the write itself.
//
// A model is good at "this column is the curve and rows 181+ are custom
// orders". It is not the thing you want silently deciding that H2607- 09904
// and H2607-09904 are different sticks.
// ---------------------------------------------------------------------------
import * as XLSX from "xlsx";
import { callClaudeToCompletion } from "./anthropic";
import { CLAUDE_MANAGER_MODEL } from "./models";
import { fetchAllStickRecords, appendSheetRows, updateSheetRow } from "./zoho-sheet";
import { specKey } from "./production-batches";
import {
  listPreorderRows,
  markPreorderReceived,
  type PreorderRow,
} from "./preorder-rows";

/** Header text on the Player tab, in the sheet's own words. */
export const PLAYER_COLUMNS = [
  "Level",
  "Size (inch)",
  "Carbon",
  "Kick Point",
  "Hand",
  "Flex",
  "Curve",
  "Base Color",
  "Decal Color",
  "Serial Number",
  "Status",
  "Date Sold",
] as const;

export interface IntakeRow {
  /** 1-based row in the uploaded file, so a query can be traced back. */
  sourceRow: number;
  level: string;
  size: string;
  carbon: string;
  kickPoint: string;
  hand: string;
  flex: string;
  curve: string;
  baseColor: string;
  decalColor: string;
  serial: string;
  /** Why this row is not going in: custom build, goalie, no serial, already
   *  on the sheet. Empty means it is stock and ready. */
  excludeReason?: string;
  /** Anything worth a human glance that isn't disqualifying. */
  notes?: string;
}

export interface IntakeResult {
  rows: IntakeRow[];
  /** Serials that needed tidying, as "before → after". Shown so the fix is
   *  visible rather than silent. */
  serialsCleaned: string[];
  /** What Stockton concluded about the file's shape — shown so the mapping
   *  can be sanity-checked rather than taken on trust. */
  interpretation: string;
  warnings: string[];
}

/* ── Deterministic cleanup ─────────────────────────────────────────────── */

/**
 * Serials arrive as "H2607-09904", "H2607- 09904" and "H260710165" for what
 * is the same format. Normalising is what makes dedupe mean anything.
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

/** '58”' / '56"' / '58 in' → '58'. The sheet stores a bare number. */
export function normalizeSize(raw: string): string {
  const m = String(raw ?? "").match(/\d+(\.\d+)?/);
  return m ? m[0] : "";
}

export function normalizeHand(raw: string): string {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v.startsWith("l")) return "Left";
  if (v.startsWith("r")) return "Right";
  return String(raw ?? "").trim();
}

/* ── Reading the workbook ──────────────────────────────────────────────── */

/** The sheet as a plain grid of trimmed strings — no header assumptions. */
export function workbookToGrid(buffer: ArrayBuffer): string[][] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: true,
    defval: "",
    raw: false,
  });
  return rows.map((r) =>
    (r as unknown[]).map((c) => (c == null ? "" : String(c).trim()))
  );
}

const SYSTEM = `You are Stockton Ledger, Director of Inventory Operations at Tilt Hockey.

A received-stock spreadsheet has been handed to you. It was typed by a human, so expect: headers split across two rows, section separators mid-table ("Box 2", "BOX 3"), a custom-orders section, a goalie section, blank rows, and stray formatting.

Your job is to say which rows are STOCK sticks for the player inventory, and which are not.

Rules that decide it:
- A row with a person's name or a jersey number against it is a CUSTOM build, not stock. Exclude it.
- Anything under a "Custom Order" heading is custom, however it looks. Exclude it.
- Goalie sticks are not player stock. Exclude them.
- Separator, note, heading and blank rows are not sticks at all. Exclude them.
- A stock row needs a serial number. No serial, no inventory.

Level is often left blank. Infer it from the size using the level/size pairs already on the live sheet, which are given to you. If a size falls outside every observed range, leave level empty and say so in the row's note rather than guessing.

Serial numbers, sizes and hands are normalised automatically AFTER you hand them back — stray spaces, missing dashes, casing and inch marks are all handled in code. Do not warn about them; they are already fixed by the time the owner sees your preview. Pass the values through as they appear and say nothing about their formatting.

If the owner has given you instructions, they override your own judgement. Apply them exactly and say in your interpretation how you applied them.

Return ONLY a JSON object, no prose around it:
{
  "interpretation": "one paragraph: which columns map to what, where each section starts and ends, and how you inferred level",
  "warnings": ["anything the owner should look at before this is written"],
  "rows": [
    {
      "sourceRow": 7,
      "level": "Junior",
      "size": "58",
      "carbon": "24K",
      "kickPoint": "Mid",
      "hand": "left",
      "flex": "50",
      "curve": "T28M",
      "baseColor": "White",
      "decalColor": "Halo",
      "serial": "H2607-10165",
      "excludeReason": "",
      "notes": ""
    }
  ]
}

Include EVERY row you judged to be a stick — stock and custom alike — and use excludeReason to say why the custom ones are out. Rows that are separators, headings or blank should be left out entirely. Copy values through as they appear; normalisation happens downstream.`;

/**
 * Ask Stockton to interpret the grid, then apply the cleanup and dedupe that
 * shouldn't depend on a model getting it right.
 */
export async function interpretIntake(
  grid: string[][],
  instructions?: string
): Promise<IntakeResult> {
  // Level/size pairs already on the sheet, so level inference follows Tilt's
  // real brackets instead of a guess about hockey sizing.
  let observed = "";
  const existingSerials = new Set<string>();
  try {
    const sticks = await fetchAllStickRecords();
    for (const s of sticks) existingSerials.add(normalizeSerial(s.serial_number));
    const pairs = new Map<string, Set<number>>();
    for (const s of sticks) {
      if (!s.level || !s.size) continue;
      if (!pairs.has(s.level)) pairs.set(s.level, new Set());
      pairs.get(s.level)!.add(s.size);
    }
    observed = [...pairs.entries()]
      .map(([lvl, sizes]) => {
        const arr = [...sizes].sort((a, b) => a - b);
        return `${lvl}: ${arr[0]}–${arr[arr.length - 1]}" (${arr.join(", ")})`;
      })
      .join("\n");
  } catch {
    observed = "(the live sheet could not be read, so no observed ranges)";
  }

  const body = grid
    .map((r, i) => `${i + 1}\t${r.join("\t")}`)
    .filter((line) => line.split("\t").slice(1).some((c) => c !== ""))
    .join("\n");

  const ownerNote = instructions?.trim()
    ? `\n\nINSTRUCTIONS FROM CHRIS — these override your own judgement:\n${instructions.trim()}\n`
    : "";

  const res = await callClaudeToCompletion({
    systemPrompt: SYSTEM,
    userMessage: `Level and size pairs already on the live sheet:\n${observed || "(none)"}${ownerNote}\n\nThe uploaded file, one row per line, tab-separated, prefixed by its row number:\n\n${body}`,
    model: CLAUDE_MANAGER_MODEL,
    maxTokens: 16000,
    temperature: 0,
  });

  const parsed = extractJson(res.text);
  const raw = Array.isArray(parsed.rows) ? (parsed.rows as Record<string, unknown>[]) : [];

  const seen = new Set<string>();
  const cleaned: string[] = [];
  const rows: IntakeRow[] = raw.map((r) => {
    const rawSerial = String(r.serial ?? "").trim();
    const serial = normalizeSerial(rawSerial);
    if (rawSerial && serial && rawSerial.toUpperCase() !== serial) {
      cleaned.push(`${rawSerial} → ${serial}`);
    }
    let excludeReason = String(r.excludeReason ?? "").trim();

    // Code owns these, not the model: a wrong call here writes a duplicate
    // stick or an unfindable serial into the source of truth.
    if (!excludeReason && !serial) excludeReason = "No serial number";
    if (!excludeReason && existingSerials.has(serial)) {
      excludeReason = "Already on the inventory sheet";
    }
    if (!excludeReason && seen.has(serial)) {
      excludeReason = "Duplicate serial within this file";
    }
    if (!excludeReason) seen.add(serial);

    return {
      sourceRow: Number(r.sourceRow) || 0,
      level: String(r.level ?? "").trim(),
      size: normalizeSize(String(r.size ?? "")),
      carbon: String(r.carbon ?? "").trim(),
      kickPoint: String(r.kickPoint ?? "").trim(),
      hand: normalizeHand(String(r.hand ?? "")),
      flex: String(r.flex ?? "").trim(),
      curve: String(r.curve ?? "").trim(),
      baseColor: String(r.baseColor ?? "").trim(),
      decalColor: String(r.decalColor ?? "").trim(),
      serial,
      excludeReason: excludeReason || undefined,
      notes: String(r.notes ?? "").trim() || undefined,
    };
  });

  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [];
  // Say what was fixed rather than what looked wrong — the values below are
  // the cleaned ones, and a warning about spaces that are already gone reads
  // as work still to do.
  const serialsCleaned = cleaned;
  const missingLevel = rows.filter((r) => !r.excludeReason && !r.level).length;
  if (missingLevel > 0) {
    warnings.push(
      `${missingLevel} stock rows have no level. They can still be written, but they won't match a SKU in reconciliation until a level is set.`
    );
  }

  return {
    rows,
    interpretation: String(parsed.interpretation ?? "").trim(),
    warnings,
    serialsCleaned,
  };
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Stockton did not return JSON. Raw start: " + text.slice(0, 200));
  }
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

/* ── Writing ───────────────────────────────────────────────────────────── */

/**
 * Put the included rows on the sheet as Available stock.
 *
 * A stick that was PRE-ORDERED already has a row: written when the batch was
 * placed, carrying a `PROD-nnnn` placeholder in the Serial Number column and
 * possibly already sold to somebody. Those are FILLED IN — the real serial
 * replaces the placeholder — rather than appended, or the sheet would end up
 * with two rows for one physical stick and the customer's order would point at
 * a row that no longer describes anything.
 *
 * Only sticks with no matching pre-order row are appended.
 *
 * Re-checks the live sheet immediately before writing: a preview can sit on
 * screen for a while, and the sheet is the source of truth for the website.
 */
export async function commitIntake(
  rows: IntakeRow[]
): Promise<{
  added: number;
  filled: number;
  skipped: { serial: string; reason: string }[];
}> {
  const usable = rows.filter((r) => !r.excludeReason && r.serial);
  const skipped: { serial: string; reason: string }[] = [];

  const existing = new Set<string>();
  const statusBySerial = new Map<string, string>();
  try {
    for (const s of await fetchAllStickRecords()) {
      const sn = normalizeSerial(s.serial_number);
      existing.add(sn);
      statusBySerial.set(sn, String(s.status ?? "").trim().toLowerCase());
    }
  } catch (err) {
    throw new Error(
      `Refusing to write — the live sheet couldn't be read to check for duplicates: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Pre-order rows still waiting on a stick, grouped by spec — an arriving
  // stick claims one of these before we consider appending anything.
  const openPreorders = new Map<string, PreorderRow[]>();
  for (const row of Object.values(await listPreorderRows())) {
    if (row.serial) continue; // already filled by an earlier shipment
    const list = openPreorders.get(row.specKey) ?? [];
    list.push(row);
    openPreorders.set(row.specKey, list);
  }

  const records: Record<string, string>[] = [];
  const seen = new Set<string>();
  const toFill: { row: PreorderRow; serial: string }[] = [];
  for (const r of usable) {
    if (existing.has(r.serial) || seen.has(r.serial)) {
      skipped.push({ serial: r.serial, reason: "already on the sheet" });
      continue;
    }
    seen.add(r.serial);

    // Was this stick pre-ordered? Then its row exists — fill it, don't add one.
    const waiting = openPreorders.get(specKey(r));
    const claim = waiting?.shift();
    if (claim) {
      toFill.push({ row: claim, serial: r.serial });
      continue;
    }

    records.push({
      Level: r.level,
      "Size (inch)": r.size,
      Carbon: r.carbon,
      "Kick Point": r.kickPoint,
      Hand: r.hand,
      Flex: r.flex,
      Curve: r.curve,
      "Base Color": r.baseColor,
      "Decal Color": r.decalColor,
      "Serial Number": r.serial,
      Status: "Available",
      "Date Sold": "",
    });
  }

  // Fill the pre-order rows first. Status is deliberately NOT forced to
  // Available: a stick sold while it was still being built must stay Sold, or
  // the shipment that finally delivers it would put it back on the storefront
  // and sell it to a second customer.
  let filled = 0;
  for (const { row, serial } of toFill) {
    try {
      // Only lift it out of "In Production" if it is still unsold. A stick
      // bought while it was being built stays Sold — flipping it back to
      // Available would relist a stick that already belongs to somebody.
      const current = statusBySerial.get(normalizeSerial(row.preorderId)) ?? "";
      const data: Record<string, string> = { "Serial Number": serial };
      if (current !== "sold") data.Status = "Available";
      await updateSheetRow(row.tab, `"Serial Number" = "${row.preorderId}"`, data);
      await markPreorderReceived(row.preorderId, serial);
      filled++;
    } catch (err) {
      skipped.push({
        serial,
        reason: `couldn't fill pre-order row ${row.preorderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  if (records.length === 0) return { added: 0, filled, skipped };
  const { added } = await appendSheetRows("Player", records);
  return { added, filled, skipped };
}
