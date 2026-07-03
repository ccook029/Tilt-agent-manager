// ---------------------------------------------------------------------------
// Pipeline: Weekly materials R&D research scan
// ---------------------------------------------------------------------------
import { callClaude } from "@/lib/anthropic";
import { sendAnalyticsReport } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import agentConfig from "@/agents/materials-rd-agent.config";
import { renderOrgKnowledge } from "@/lib/org-knowledge";
import { postSignal } from "@/lib/signals";
import { headlineFrom } from "@/lib/signal-headline";

export async function runResearchScan(context?: string) {
  const startedAt = new Date();
  const scanDate = startedAt.toISOString();

  let userMessage = agentConfig.researchPrompt;
  if (context) {
    userMessage += `\n\nAdditional focus from the team: ${context}`;
  }
  userMessage += `\n\nToday's date: ${scanDate.slice(0, 10)}`;

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
  const emailSubject = `Materials R&D Weekly Research — ${scanDate.slice(0, 10)}`;

  const pdfBuffer = await generateReportPDF({
    title: "Materials Science Research Scan",
    subtitle: "Weekly Autonomous Report",
    reportDate: scanDate.slice(0, 10),
    agentName: agentConfig.name,
    reportText: response.text,
  });

  const pdfFilename = `tilt-materials-research-${scanDate.slice(0, 10)}.pdf`;

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

  await postSignal({
    source: "materials-rd",
    headline: headlineFrom(response.text),
  }).catch(() => {});

  return {
    report: response.text,
    scanDate,
    tokens: { input: response.inputTokens, output: response.outputTokens },
    emailSentTo: emailTo,
  };
}
