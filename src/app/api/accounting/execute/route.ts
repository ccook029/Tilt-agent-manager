// ---------------------------------------------------------------------------
// /api/accounting/execute — Run a Wave 1 categorization batch.
//
// POST { "limit"?: number, "dryRun"?: boolean }
//   - dryRun omitted: auto (LIVE if the Zoho MCP write tools are connected,
//     otherwise a safe PROPOSE run over the real data).
//   - dryRun:true  forces propose mode even when MCP is connected.
//
// GET ?limit=10  → convenience trigger (browser-testable, like /diagnose).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { runCategorizationBatch } from "@/lib/accounting-execute";
import { saveRunLogs } from "@/lib/store";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "10");
  const dryRun = request.nextUrl.searchParams.get("dryRun");
  return run(limit, dryRun === null ? undefined : dryRun === "true");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { limit = 15, dryRun } = body as { limit?: number; dryRun?: boolean };
  return run(limit, dryRun);
}

async function run(limit: number, dryRun?: boolean) {
  const startedAt = new Date();
  try {
    const result = await runCategorizationBatch({ limit, dryRun });

    await saveRunLogs([
      {
        id: `accounting-execute-${result.batchId}`,
        agentId: "accounting",
        agentName: `Penny Quill (Auto-Categorize${result.mode === "proposed" ? " — Dry Run" : ""})`,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        status: "success",
        output: result.report,
        model: "claude-sonnet-4-6",
      },
    ]);

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[accounting/execute] Failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
