// ---------------------------------------------------------------------------
// Pipeline: Product design innovation concept
// ---------------------------------------------------------------------------
import { callClaude } from "@/lib/anthropic";
import { sendAnalyticsReport } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import agentConfig from "@/agents/product-design-agent.config";
import { renderOrgKnowledge } from "@/lib/org-knowledge";

export async function runInnovation() {
  const startedAt = new Date();

  const response = await callClaude({
    systemPrompt: agentConfig.systemPrompt + (await renderOrgKnowledge()),
    userMessage: agentConfig.innovationPrompt,
    model: agentConfig.model,
    maxTokens: agentConfig.maxTokens,
    temperature: 0.7,
  });

  const pdfBuffer = await generateReportPDF({
    title: "Product Innovation Concept",
    subtitle: "Autonomous R&D — Maya Blueprint",
    reportDate: startedAt.toISOString().slice(0, 10),
    agentName: "Maya Blueprint — Head of Product Design",
    reportText: response.text,
  });

  const pdfFilename = `tilt-innovation-${startedAt.toISOString().slice(0, 10)}.pdf`;

  const emailTo =
    process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
    agentConfig.email.to;

  await sendAnalyticsReport({
    to: emailTo,
    from: agentConfig.email.from,
    subject: `New Product Concept from Maya — ${startedAt.toISOString().slice(0, 10)}`,
    reportText: response.text,
    pdfBuffer,
    pdfFilename,
  });

  const finishedAt = new Date();

  await saveRunLogs([
    {
      id: `product-design-innovation-${startedAt.toISOString()}`,
      agentId: "product-design",
      agentName: "Maya Blueprint (Innovation)",
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
    concept: response.text,
    tokens: { input: response.inputTokens, output: response.outputTokens },
    emailSentTo: emailTo,
  };
}
