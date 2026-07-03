// ---------------------------------------------------------------------------
// Pipeline: Biweekly factory reorder recommendation — powered by Stockton
// ---------------------------------------------------------------------------
import { callClaude, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import { fetchFactoryReorderData } from "@/lib/factory-reorder";
import agentConfig from "@/agents/inventory-agent.config";
import { renderOrgKnowledge } from "@/lib/org-knowledge";

export async function runFactoryReorder(context?: string) {
  const startedAt = new Date();
  const reportDate = startedAt.toISOString().slice(0, 10);

  // Fetch all reorder data (stock levels, velocity, custom orders, open POs)
  const reorderData = await fetchFactoryReorderData();

  const taskPrompt = agentConfig.taskPrompts["factory-reorder"];
  const variables: Record<string, string> = {
    context: reorderData + (context ? `\n\n## Additional Context\n${context}` : ""),
    date: reportDate,
    task_label: "Factory Reorder Recommendation",
  };

  const userMessage = substituteVariables(taskPrompt, variables);

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
  const emailSubject = `Factory Reorder Recommendation — ${reportDate}`;

  const pdfBuffer = await generateReportPDF({
    title: "Factory Reorder Recommendation",
    subtitle: "Tilt Hockey — Biweekly Order",
    reportDate,
    agentName: agentConfig.name,
    reportText: response.text,
  });

  const pdfFilename = `tilt-factory-reorder-${reportDate}.pdf`;

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
      id: `inventory-factory-reorder-${startedAt.toISOString()}`,
      agentId: agentConfig.id,
      agentName: `${agentConfig.name} (Factory Reorder)`,
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
