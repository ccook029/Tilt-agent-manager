// ---------------------------------------------------------------------------
// GET /api/accounting/metrics — numbers that MOVE for the dashboard (audit #17).
// The cleanup burn-down plus the running tallies: policies learned, changes
// written to the books, and open decisions. Owner-gated.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { guardAccountingOwner } from "@/lib/os-identity";
import { getProgress } from "@/lib/progress";
import { getPolicies, getOpenEscalations } from "@/lib/policy-ledger";
import { getActions } from "@/lib/action-log";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await guardAccountingOwner(request);
  if (guard) return guard;

  const [points, policies, open, actions] = await Promise.all([
    getProgress().catch(() => []),
    getPolicies().catch(() => []),
    getOpenEscalations().catch(() => []),
    getActions().catch(() => []),
  ]);

  const executed = actions.filter((a) => a.mode === "executed" && !a.reversed);
  const latest = points[points.length - 1] ?? null;
  const first = points[0] ?? null;

  return NextResponse.json(
    {
      ok: true,
      backlog: {
        points: points.slice(-30).map((p) => ({ at: p.at, uncategorized: p.uncategorized })),
        current: latest?.uncategorized ?? null,
        start: first?.uncategorized ?? null,
        cleared:
          first && latest ? Math.max(0, first.uncategorized - latest.uncategorized) : 0,
      },
      policiesLearned: policies.length,
      changesWritten: executed.length,
      openDecisions: open.length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
