// ---------------------------------------------------------------------------
// GET /api/agents/logs — Retrieve agent run history for the dashboard
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getRunLogs, getRunLogsByAgent } from "@/lib/store";

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agentId");

  try {
    const logs = agentId
      ? await getRunLogsByAgent(agentId)
      : await getRunLogs();

    return NextResponse.json({ ok: true, logs });
  } catch (err) {
    console.error("[api] agents/logs failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
