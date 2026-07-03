// ---------------------------------------------------------------------------
// GET /api/accounting/actions — Penny's write audit trail, human-readable.
//
// Answers "what has Penny actually done to my books?" definitively:
//   executed  = real writes to Zoho Books (reversible via uncategorize)
//   proposed  = dry-run decisions or guardrail skips — nothing was written
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  getRecentActions,
  getActionById,
  markActionReversed,
} from "@/lib/action-log";
import { guardAccountingOwner, getCurrentStaff } from "@/lib/os-identity";
import { uncategorizeTxn } from "@/lib/zoho-books";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await guardAccountingOwner(request);
  if (guard) return guard;

  const recent = await getRecentActions(200);
  const executed = recent.filter((a) => a.mode === "executed");
  const proposed = recent.filter((a) => a.mode === "proposed");

  return NextResponse.json(
    {
      summary: {
        totalLogged: recent.length,
        writtenToBooks: executed.length,
        proposedOrSkipped: proposed.length,
        verdict:
          executed.length === 0
            ? "Penny has NOT written anything to Zoho Books yet."
            : `Penny has written ${executed.length} change(s) to Zoho Books — listed below, newest first.`,
      },
      written: executed.map((a) => ({
        id: a.id,
        when: a.timestamp,
        what: a.summary,
        transaction: a.targetId,
        details: a.after ?? null,
        batch: a.batchId,
        reversed: a.reversed ?? false,
        reversedAt: a.reversedAt ?? null,
      })),
      proposedOrSkipped: proposed.slice(0, 50).map((a) => ({
        when: a.timestamp,
        what: a.summary,
        transaction: a.targetId,
      })),
    },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}

// POST { actionId } — undo one executed categorization: reverse the Zoho write
// (return the feed line to Uncategorized) and mark the action reversed.
export async function POST(request: NextRequest) {
  const guard = await guardAccountingOwner(request);
  if (guard) return guard;

  const body = await request.json().catch(() => ({}));
  const actionId = String((body as { actionId?: string }).actionId ?? "");
  if (!actionId) {
    return NextResponse.json({ error: "actionId is required" }, { status: 400 });
  }

  const action = await getActionById(actionId);
  if (!action) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }
  if (action.mode !== "executed") {
    return NextResponse.json(
      { error: "Nothing was written to Zoho for this entry — nothing to undo." },
      { status: 400 }
    );
  }
  if (action.reversed) {
    return NextResponse.json({ ok: true, alreadyReversed: true });
  }

  try {
    await uncategorizeTxn(action.targetId);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Couldn't reverse it in Zoho Books: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  }

  const staff = await getCurrentStaff();
  const updated = await markActionReversed(actionId, staff?.name);
  return NextResponse.json({ ok: true, action: updated });
}
