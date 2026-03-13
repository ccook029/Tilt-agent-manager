// ---------------------------------------------------------------------------
// GET /api/cron/run-agents — Vercel Cron endpoint
//
// Vercel calls this on the schedule defined in vercel.json.
// Secured via CRON_SECRET (Vercel injects the Authorization header).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { runAllAgents } from "@/lib/orchestrator";

export const maxDuration = 300; // allow up to 5 min for all agents

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runAllAgents();
    return NextResponse.json({
      ok: true,
      agentsRun: result.logs.length,
      statuses: result.logs.map((l) => ({
        agent: l.agentName,
        status: l.status,
        durationMs: l.durationMs,
      })),
      summaryGenerated: !!result.summary,
      emailSent: result.emailSent,
    });
  } catch (err) {
    console.error("[cron] run-agents failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
