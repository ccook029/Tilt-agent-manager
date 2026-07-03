// ---------------------------------------------------------------------------
// Pipeline: Daily analytics report
// ---------------------------------------------------------------------------
import { fetchGA4Data, getDailyReportRanges } from "@/lib/ga4";
import { callClaude, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import agentConfig from "@/agents/website-analytics-agent.config";
import { renderOrgKnowledge } from "@/lib/org-knowledge";

export async function runDailyReport(context?: string) {
  const startedAt = new Date();
  const { current, prior, label } = getDailyReportRanges(startedAt);

  const [gaDataCurrent, gaDataPrior] = await Promise.all([
    fetchGA4Data(current),
    fetchGA4Data(prior),
  ]);

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

  const userMessage = substituteVariables(agentConfig.userPrompt, variables);

  const response = await callClaude({
    systemPrompt: agentConfig.systemPrompt + (await renderOrgKnowledge()),
    userMessage,
    model: agentConfig.model,
    maxTokens: agentConfig.maxTokens,
    temperature: agentConfig.temperature,
  });

  const emailTo =
    process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
    agentConfig.email.to;
  const emailFrom = agentConfig.email.from;
  const emailSubject = substituteVariables(
    agentConfig.email.subjectTemplate,
    variables
  );

  const pdfBuffer = await generateReportPDF({
    title: "Website Analytics Report",
    subtitle: `${label} Report`,
    reportDate: current.endDate,
    agentName: agentConfig.name,
    reportText: response.text,
  });

  const pdfFilename = `tilt-analytics-${current.endDate}.pdf`;

  await sendAnalyticsReport({
    to: emailTo,
    from: emailFrom,
    subject: emailSubject,
    reportText: response.text,
    pdfBuffer,
    pdfFilename,
  });

  const finishedAt = new Date();

  await saveRunLogs([
    {
      id: `analytics-${startedAt.toISOString()}`,
      agentId: agentConfig.id,
      agentName: `${agentConfig.name} (${label})`,
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
    periodLabel: label,
    period: { current, prior },
    tokens: { input: response.inputTokens, output: response.outputTokens },
    emailSentTo: emailTo,
  };
}
