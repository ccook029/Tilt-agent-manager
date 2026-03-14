// ---------------------------------------------------------------------------
// GET /api/reports?agentId=xxx — Retrieve report PDFs as downloadable links
//
// Returns a list of reports with metadata. Each report can be re-generated
// as a PDF on demand via POST /api/reports/download.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getRunLogs, getRunLogsByAgent } from "@/lib/store";

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agentId");

  try {
    const logs = agentId
      ? await getRunLogsByAgent(agentId)
      : await getRunLogs();

    // Transform logs into report entries
    const reports = logs
      .filter((l) => l.status === "success" && l.output)
      .map((l) => ({
        id: l.id,
        agentId: l.agentId,
        agentName: l.agentName,
        date: l.startedAt,
        durationMs: l.durationMs,
        tokensUsed: l.tokensUsed,
        // First 200 chars as preview
        preview: l.output.slice(0, 200).replace(/\n/g, " ") + "...",
      }));

    return NextResponse.json({ ok: true, reports });
  } catch (err) {
    console.error("[api] reports failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
