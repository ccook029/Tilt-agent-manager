// ---------------------------------------------------------------------------
// POST /api/agents/run — Manually trigger agent(s) from the dashboard
//
// Body: { agentId?: string }
//   - If agentId is provided, run only that agent.
//   - If omitted, run all enabled agents.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { runAllAgents, runSingleAgent } from "@/lib/orchestrator";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { agentId } = body as { agentId?: string };

    if (agentId) {
      const log = await runSingleAgent(agentId);
      if (!log) {
        return NextResponse.json(
          { error: `Agent "${agentId}" not found` },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, log });
    }

    const result = await runAllAgents();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api] agents/run failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
