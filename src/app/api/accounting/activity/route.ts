// ---------------------------------------------------------------------------
// GET /api/accounting/activity — what Penny is doing + everything she's done.
//
// Returns { pending, runs }: in-flight dispatched tasks (live "Working on…")
// and her recent run-log history (newest first). Powers the Penny Activity
// panel. Owner-gated like the rest of the accounting console.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { getRunLogsByAgent } from "@/lib/store";
import { getPendingTasks } from "@/lib/accounting-activity";
import { getCurrentStaff, isAccountingOwner } from "@/lib/os-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await getCurrentStaff().catch(() => null);
  if (!isAccountingOwner(staff)) {
    return NextResponse.json({ error: "The accounting console is restricted." }, { status: 403 });
  }

  const [runs, pending] = await Promise.all([
    getRunLogsByAgent("accounting").catch(() => []),
    getPendingTasks().catch(() => []),
  ]);

  return NextResponse.json(
    { ok: true, pending, runs: runs.slice(0, 30) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
