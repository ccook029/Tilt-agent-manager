// ---------------------------------------------------------------------------
// Pipeline: Weekly inventory health report — powered by Zoho Inventory data
// ---------------------------------------------------------------------------
import { callClaude, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import { fetchInventorySnapshot } from "@/lib/zoho";
import agentConfig from "@/agents/inventory-agent.config";

export async function runInventoryWeeklyReport(context?: string) {
  const startedAt = new Date();
  const reportDate = startedAt.toISOString().slice(0, 10);

  // Fetch live inventory data from Zoho
  const inventoryData = await fetchInventorySnapshot();

  const variables: Record<string, string> = {
    date: reportDate,
  };

  let userMessage = substituteVariables(agentConfig.weeklyReportPrompt, variables);

  // Inject the real Zoho data
  userMessage += `\n\n---\n\nHere is the live inventory data from Zoho Inventory:\n\n${inventoryData}`;

  if (context) {
    userMessage += `\n\nAdditional focus from the team: ${context}`;
  }

  const response = await callClaude({
    systemPrompt: agentConfig.systemPrompt,
    userMessage,
    model: agentConfig.model,
    maxTokens: agentConfig.maxTokens,
    temperature: agentConfig.temperature,
  });

  const emailTo =
    process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
    agentConfig.email.to;
  const emailFrom = agentConfig.email.from;
  const emailSubject = `Inventory Weekly Health Report — ${reportDate}`;

  const pdfBuffer = await generateReportPDF({
    title: "Weekly Inventory Health Report",
    subtitle: "Tilt Hockey — Zoho Inventory",
    reportDate,
    agentName: agentConfig.name,
    reportText: response.text,
  });

  const pdfFilename = `tilt-inventory-weekly-${reportDate}.pdf`;

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
    tokens: { input: response.inputTokens, output: response.outputTokens },
    emailSentTo: emailTo,
  };
}
