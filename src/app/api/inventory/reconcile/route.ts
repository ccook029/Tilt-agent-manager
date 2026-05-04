// ---------------------------------------------------------------------------
// GET /api/inventory/reconcile — Direct Sheet → Inventory sync
//
// Compares the master Zoho Sheet against Zoho Inventory and creates
// inventory adjustments to correct any discrepancies. No Claude call —
// just reads, compares, and fixes.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { applyStockAdjustments } from "@/lib/zoho-sync";
import { saveRunLogs } from "@/lib/store";

export const maxDuration = 120;

export async function GET() {
  const startedAt = new Date();

  try {
    const result = await applyStockAdjustments();

    const finishedAt = new Date();

    await saveRunLogs([
      {
        id: `inventory-reconcile-${startedAt.toISOString()}`,
        agentId: "inventory",
        agentName: "Inventory Management Agent (Reconcile)",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status: "success",
        output: result,
        model: "n/a",
        tokensUsed: 0,
      },
    ]);

    return NextResponse.json({
      ok: true,
      result,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
