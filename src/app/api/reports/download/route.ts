// ---------------------------------------------------------------------------
// POST /api/reports/download — Re-generate and download a report PDF
//
// Body: { "reportId": "the-log-id" }
// Returns the PDF as a downloadable binary response.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import { getPersonaByAgentId } from "@/lib/personas";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { reportId } = (await request.json()) as { reportId: string };

    if (!reportId) {
      return NextResponse.json({ error: "reportId is required" }, { status: 400 });
    }

    const logs = await getRunLogs();
    const log = logs.find((l) => l.id === reportId);

    if (!log) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const persona = getPersonaByAgentId(log.agentId);
    const agentLabel = persona ? `${persona.name} — ${persona.title}` : log.agentName;

    const pdfBuffer = await generateReportPDF({
      title: log.agentName,
      subtitle: "Report",
      reportDate: log.startedAt.slice(0, 10),
      agentName: agentLabel,
      reportText: log.output,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="tilt-report-${log.startedAt.slice(0, 10)}.pdf"`,
      },
    });
  } catch (err) {
    console.error("[api] reports/download failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
