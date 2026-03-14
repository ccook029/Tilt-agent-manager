// ---------------------------------------------------------------------------
// GET/POST /api/competitors/weekly — Weekly competitor intel report (Vercel Cron)
//
// Vercel Cron calls this every Wednesday at 12:00 UTC (8 AM ET).
// Also accepts POST for manual triggers.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { runCompetitorScan } from "@/lib/competitors";
import { callClaude, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport, sendErrorNotification } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import agentConfig from "@/agents/competitor-intel-agent.config";

export const maxDuration = 300;

async function runCompetitorReport(context?: string) {
  const startedAt = new Date();

  // Run the competitor scan (Google News RSS + optional Serper.dev)
  const { summary, scanDate } = await runCompetitorScan();

  // Build the variables map
  const variables: Record<string, string> = {
    scan_date: scanDate.slice(0, 10),
    competitor_data: summary,
    context: context ?? "",
  };

  // Assemble the user message from the config template
  const userMessage = substituteVariables(agentConfig.userPrompt, variables);

  // Call Claude
  const response = await callClaude({
    systemPrompt: agentConfig.systemPrompt,
    userMessage,
    model: agentConfig.model,
    maxTokens: agentConfig.maxTokens,
    temperature: agentConfig.temperature,
  });

  // Determine email recipients
  const emailTo =
    process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
    agentConfig.email.to;
  const emailFrom = agentConfig.email.from;
  const emailSubject = substituteVariables(
    agentConfig.email.subjectTemplate,
    variables
  );

  // Generate branded PDF
  const pdfBuffer = await generateReportPDF({
    title: "Competitor Intelligence Report",
    subtitle: "Weekly Scan",
    reportDate: scanDate.slice(0, 10),
    agentName: agentConfig.name,
    reportText: response.text,
  });

  const pdfFilename = `tilt-competitor-intel-${scanDate.slice(0, 10)}.pdf`;

  // Send the report with PDF attachment
  await sendAnalyticsReport({
    to: emailTo,
    from: emailFrom,
    subject: emailSubject,
    reportText: response.text,
    pdfBuffer,
    pdfFilename,
  });

  const finishedAt = new Date();

  // Persist to store for the dashboard
  await saveRunLogs([
    {
      id: `competitor-intel-${startedAt.toISOString()}`,
      agentId: agentConfig.id,
      agentName: agentConfig.name,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: "success",
      output: response.text,
      model: agentConfig.model,
      tokensUsed: response.inputTokens + response.outputTokens,
    },
  ]);

  return {
    report: response.text,
    scanDate,
    tokens: {
      input: response.inputTokens,
      output: response.outputTokens,
    },
    emailSentTo: emailTo,
  };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runCompetitorReport();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[competitors/weekly] Pipeline failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[competitors/weekly] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { context } = body as { context?: string };
    const result = await runCompetitorReport(context);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[competitors/weekly] Pipeline failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[competitors/weekly] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
