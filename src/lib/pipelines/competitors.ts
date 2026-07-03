// ---------------------------------------------------------------------------
// Pipeline: Weekly competitor intel report
// ---------------------------------------------------------------------------
import { runCompetitorScan } from "@/lib/competitors";
import { callClaude, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport, perAgentEmailsEnabled } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import agentConfig from "@/agents/competitor-intel-agent.config";
import { renderOrgKnowledge } from "@/lib/org-knowledge";
import { postSignal } from "@/lib/signals";
import { headlineFrom } from "@/lib/signal-headline";

export async function runCompetitorReport(context?: string) {
  const startedAt = new Date();

  const { summary, scanDate } = await runCompetitorScan();

  const variables: Record<string, string> = {
    scan_date: scanDate.slice(0, 10),
    competitor_data: summary,
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
    title: "Competitor Intelligence Report",
    subtitle: "Weekly Scan",
    reportDate: scanDate.slice(0, 10),
    agentName: agentConfig.name,
    reportText: response.text,
  });

  const pdfFilename = `tilt-competitor-intel-${scanDate.slice(0, 10)}.pdf`;

  if (perAgentEmailsEnabled()) {
    await sendAnalyticsReport({
      to: emailTo,
      from: emailFrom,
      subject: emailSubject,
      reportText: response.text,
      pdfBuffer,
      pdfFilename,
    });
  }

  const finishedAt = new Date();

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

  await postSignal({
    source: "competitor-intel",
    headline: headlineFrom(response.text),
  }).catch(() => {});

  return {
    report: response.text,
    scanDate,
    tokens: { input: response.inputTokens, output: response.outputTokens },
    emailSentTo: emailTo,
  };
}
