// ---------------------------------------------------------------------------
// /api/inventory/location — move stock to a retailer (or back to Tilt).
//
//   POST { serials, location }          → the plan, nothing written
//   POST { serials, location, apply:1 } → write it
//
// Two calls on purpose. This edits the master sheet a row at a time, and the
// thing that makes that safe is a human reading the plan first — which serials
// move, which are held back, and why.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { fetchAllStickRecords, updateSheetRow } from "@/lib/zoho-sheet";
import { normalizeSerial } from "@/lib/inventory-intake";
import {
  planLocationChange,
  describePlan,
  normalizeLocation,
  LOCATION_COLUMN,
} from "@/lib/inventory-location";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The two tabs don't name the serial column the same thing: Player has
 * "Serial Number", Goalie has "SKU". Sending the Player criteria to Goalie
 * matches nothing, and Zoho reports that as a successful update of zero rows —
 * so all four goalie sticks would silently fail to move.
 */
function serialCriteria(tab: string, serial: string): string {
  const column = tab.toLowerCase().includes("goalie") ? "SKU" : "Serial Number";
  return `"${column}" = "${serial}"`;
}

function parseSerials(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s ?? "").trim());
  return String(raw ?? "")
    .split(/[\r\n,\t]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    // A pasted column often brings its header with it.
    .filter((s) => !/^(serial|serial number|serial #)$/i.test(s));
}

export async function POST(req: NextRequest) {
  let body: { serials?: unknown; location?: unknown; apply?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send JSON." }, { status: 400 });
  }

  const serials = parseSerials(body.serials);
  const location = normalizeLocation(String(body.location ?? ""));
  if (serials.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No serials. Paste one per line." },
      { status: 400 }
    );
  }

  let records;
  try {
    records = await fetchAllStickRecords();
  } catch (err) {
    // Never plan against a partial sheet: everything unread would look like a
    // serial that doesn't exist, and the plan would quietly shrink.
    return NextResponse.json(
      {
        ok: false,
        error: `Couldn't read the master sheet, so nothing was planned: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 }
    );
  }

  const plan = planLocationChange(records, serials, location, normalizeSerial);

  if (!body.apply) {
    return NextResponse.json({
      ok: true,
      applied: false,
      location,
      summary: describePlan(plan),
      ...plan,
    });
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  const written: string[] = [];
  const failed: { serial: string; error: string }[] = [];

  for (const change of plan.changes) {
    try {
      await updateSheetRow(change.tab, serialCriteria(change.tab, change.serial), {
        [LOCATION_COLUMN]: change.to,
      });
      written.push(change.serial);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ serial: change.serial, error: message });
      // A missing column fails every row identically — say so once and stop
      // rather than grinding through 77 identical failures.
      if (/column|header|not found/i.test(message) && written.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            applied: false,
            error:
              `The sheet has no "${LOCATION_COLUMN}" column yet, so nothing was ` +
              `written. Add "${LOCATION_COLUMN}" as a new header on the Player and ` +
              `Goalie tabs, then run this again. Zoho reported: ${message}`,
          },
          { status: 409 }
        );
      }
    }
  }

  if (written.length > 0) {
    await postSignal({
      source: "stick-inventory",
      headline: `${written.length} stick${written.length === 1 ? "" : "s"} moved to ${location}`,
      detail:
        `Consignment stock stays Available — it's for sale at ${location}, ` +
        `not at Tilt.` + (failed.length ? ` ${failed.length} failed to write.` : ""),
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: failed.length === 0,
    applied: true,
    location,
    written: written.length,
    failed,
    summary: describePlan(plan),
    ...plan,
  });
}
