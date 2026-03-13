// ---------------------------------------------------------------------------
// GET/POST /api/analytics/daily — Daily analytics report (Vercel Cron)
//
// Vercel Cron calls this Mon–Fri at 12:00 UTC (8 AM ET).
//   Monday:      reports on Saturday + Sunday
//   Tue–Fri:     reports on the previous day
// Also accepts POST for manual triggers.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { fetchGA4Data, getDailyReportRanges } from "@/lib/ga4";
import { callClaude, substituteVariables } from "@/lib/anthropic";
import {
  sendAnalyticsReport,
  sendErrorNotification,
} from "@/lib/email";
import agentConfig from "@/agents/website-analytics-agent.config";

export const maxDuration = 300;

async function runDailyReport(context?: string) {
  const now = new Date();
  const { current, prior, label } = getDailyReportRanges(now);

  // Pull GA4 data for both periods concurrently
  const [gaDataCurrent, gaDataPrior] = await Promise.all([
    fetchGA4Data(current),
    fetchGA4Data(prior),
  ]);

  // Build the variables map
  const variables: Record<string, string> = {
    period_label: label,
    period_end: current.endDate,
    current_period_start: current.startDate,
    current_period_end: current.endDate,
    prior_period_start: prior.startDate,
    prior_period_end: prior.endDate,
    ga_data_current: gaDataCurrent,
    ga_data_prior: gaDataPrior,
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

  // Send the report
  await sendAnalyticsReport({
    to: emailTo,
    from: emailFrom,
    subject: emailSubject,
    reportText: response.text,
  });

  return {
    report: response.text,
    periodLabel: label,
    period: { current, prior },
    tokens: {
      input: response.inputTokens,
      output: response.outputTokens,
    },
    emailSentTo: emailTo,
  };
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDailyReport();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analytics/daily] Pipeline failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[analytics/daily] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { context } = body as { context?: string };
    const result = await runDailyReport(context);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analytics/daily] Pipeline failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[analytics/daily] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
