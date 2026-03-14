// ---------------------------------------------------------------------------
// GET/POST /api/inventory/weekly — Weekly inventory health report
//
// Vercel Cron calls GET every Monday at 11:00 UTC (7 AM ET).
// POST accepts manual triggers with optional context/focus areas.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { callClaude, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport, sendErrorNotification } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import agentConfig from "@/agents/inventory-agent.config";

export const maxDuration = 300;

async function runWeeklyReport(context?: string) {
  const startedAt = new Date();
  const reportDate = startedAt.toISOString().slice(0, 10);

  // Build the user message from the weekly report prompt
  const variables: Record<string, string> = {
    date: reportDate,
  };

  let userMessage = substituteVariables(agentConfig.weeklyReportPrompt, variables);
  if (context) {
    userMessage += `\n\nAdditional focus from the team: ${context}`;
  }

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
  const emailSubject = `Inventory Weekly Health Report — ${reportDate}`;

  // Generate branded PDF
  const pdfBuffer = await generateReportPDF({
    title: "Weekly Inventory Health Report",
    subtitle: "Tilt Hockey — Zoho Inventory",
    reportDate,
    agentName: agentConfig.name,
    reportText: response.text,
  });

  const pdfFilename = `tilt-inventory-weekly-${reportDate}.pdf`;

  // Send the report
  await sendAnalyticsReport({
    to: emailTo,
    from: emailFrom,
    subject: emailSubject,
    reportText: response.text,
    pdfBuffer,
    pdfFilename,
  });

  const finishedAt = new Date();

  // Persist to dashboard
  await saveRunLogs([
    {
      id: `inventory-weekly-${startedAt.toISOString()}`,
      agentId: agentConfig.id,
      agentName: `${agentConfig.name} (Weekly Report)`,
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
    reportDate,
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
    const result = await runWeeklyReport();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[inventory/weekly] Pipeline failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[inventory/weekly] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { context } = body as { context?: string };
    const result = await runWeeklyReport(context);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[inventory/weekly] Pipeline failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[inventory/weekly] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
