// ---------------------------------------------------------------------------
// Pipeline: Daily Sheet → Inventory auto-reconciliation
//
// Compares the master Zoho Sheet stick counts against Zoho Inventory
// and creates an inventory adjustment to correct any discrepancies.
// Runs daily so Zoho Inventory always reflects the Sheet (source of truth).
// ---------------------------------------------------------------------------
import { applyStockAdjustments } from "@/lib/zoho-sync";
import { saveRunLogs } from "@/lib/store";

export async function runAutoReconciliation() {
  const startedAt = new Date();

  const result = await applyStockAdjustments();

  const finishedAt = new Date();

  await saveRunLogs([
    {
      id: `inventory-auto-reconcile-${startedAt.toISOString()}`,
      agentId: "inventory",
      agentName: "Inventory Management Agent (Auto-Reconcile)",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: "success",
      output: result,
      model: "n/a",
      tokensUsed: 0,
    },
  ]);

  return { result, startedAt: startedAt.toISOString() };
}
