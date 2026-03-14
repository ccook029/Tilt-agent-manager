// ---------------------------------------------------------------------------
// GET/POST /api/materials-rd/research — Autonomous weekly research scan
//
// Vercel Cron calls this every Friday at 12:00 UTC (8 AM ET).
// Also accepts POST for manual triggers.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/anthropic";
import { sendAnalyticsReport, sendErrorNotification } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import agentConfig from "@/agents/materials-rd-agent.config";

export const maxDuration = 300;

async function runResearchScan(context?: string) {
  const startedAt = new Date();
  const scanDate = startedAt.toISOString();

  // Build the user message — autonomous research prompt + optional context
  let userMessage = agentConfig.researchPrompt;
  if (context) {
    userMessage += `\n\nAdditional focus from the team: ${context}`;
  }
  userMessage += `\n\nToday's date: ${scanDate.slice(0, 10)}`;

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
  const emailSubject = `Materials R&D Weekly Research — ${scanDate.slice(0, 10)}`;

  // Generate branded PDF
  const pdfBuffer = await generateReportPDF({
    title: "Materials Science Research Scan",
    subtitle: "Weekly Autonomous Report",
    reportDate: scanDate.slice(0, 10),
    agentName: agentConfig.name,
    reportText: response.text,
  });

  const pdfFilename = `tilt-materials-research-${scanDate.slice(0, 10)}.pdf`;

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
      id: `materials-rd-research-${startedAt.toISOString()}`,
      agentId: agentConfig.id,
      agentName: `${agentConfig.name} (Weekly Research)`,
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
    const result = await runResearchScan();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[materials-rd/research] Pipeline failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[materials-rd/research] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { context } = body as { context?: string };
    const result = await runResearchScan(context);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[materials-rd/research] Pipeline failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[materials-rd/research] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
