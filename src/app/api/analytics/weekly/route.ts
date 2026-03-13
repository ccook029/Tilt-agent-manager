// ---------------------------------------------------------------------------
// GET/POST /api/analytics/weekly — Weekly analytics report (Vercel Cron)
//
// Vercel Cron calls this every Monday at 12:00 UTC.
// Also accepts POST for compatibility with manual triggers.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  fetchGA4Data,
  getWeekRange,
  getPriorWeekRange,
} from "@/lib/ga4";
import { callClaude, substituteVariables } from "@/lib/anthropic";
import {
  sendAnalyticsReport,
  sendErrorNotification,
} from "@/lib/email";
import agentConfig from "@/agents/website-analytics-agent.config";

export const maxDuration = 300; // 5 min max for serverless

async function runWeeklyReport(context?: string) {
  const now = new Date();

  // Date ranges: last completed week + the week before that
  const currentWeek = getWeekRange(new Date(now.getTime() - 7 * 86400000));
  const priorWeek = getPriorWeekRange(new Date(now.getTime() - 7 * 86400000));

  // Pull GA4 data for both periods
  const [gaDataCurrent, gaDataPrior] = await Promise.all([
    fetchGA4Data(currentWeek),
    fetchGA4Data(priorWeek),
  ]);

  // Build the variables map
  const variables: Record<string, string> = {
    period_end: currentWeek.endDate,
    current_period_start: currentWeek.startDate,
    current_period_end: currentWeek.endDate,
    prior_period_start: priorWeek.startDate,
    prior_period_end: priorWeek.endDate,
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
    period: {
      current: currentWeek,
      prior: priorWeek,
    },
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
    const result = await runWeeklyReport();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analytics/weekly] Pipeline failed:", message);

    // Try to send an error notification
    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[analytics/weekly] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Also accept POST for manual triggers
export async function POST(request: NextRequest) {
  // POST doesn't require cron secret (used by manual trigger route)
  try {
    const body = await request.json().catch(() => ({}));
    const { context } = body as { context?: string };
    const result = await runWeeklyReport(context);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analytics/weekly] Pipeline failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[analytics/weekly] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
