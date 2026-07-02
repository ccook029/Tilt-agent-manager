// ---------------------------------------------------------------------------
// GET /api/accounting/actions — Penny's write audit trail, human-readable.
//
// Answers "what has Penny actually done to my books?" definitively:
//   executed  = real writes to Zoho Books (reversible via uncategorize)
//   proposed  = dry-run decisions or guardrail skips — nothing was written
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { getRecentActions } from "@/lib/action-log";

export const dynamic = "force-dynamic";

export async function GET() {
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
        when: a.timestamp,
        what: a.summary,
        transaction: a.targetId,
        details: a.after ?? null,
        batch: a.batchId,
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
