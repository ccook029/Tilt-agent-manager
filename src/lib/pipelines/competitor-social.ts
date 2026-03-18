// ---------------------------------------------------------------------------
// Pipeline: Weekly competitor social intel report
// ---------------------------------------------------------------------------
import { callClaude, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import { scrapeCompetitorSocials } from "@/lib/apify";
import agentConfig from "@/agents/competitor-social-agent.config";

export async function runSocialIntelReport(context?: string) {
  const startedAt = new Date();

  const scrapeResult = await scrapeCompetitorSocials(
    agentConfig.competitors,
    7
  );

  const variables: Record<string, string> = {
    scan_date: scrapeResult.scanDate.slice(0, 10),
    social_data: scrapeResult.formattedData,
    context: context ?? "",
  };

  const userMessage = substituteVariables(agentConfig.userPrompt, variables);

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
  const emailSubject = substituteVariables(
    agentConfig.email.subjectTemplate,
    variables
  );

  const pdfBuffer = await generateReportPDF({
    title: "Competitor Social Intelligence",
    subtitle: "Weekly Report",
    reportDate: scrapeResult.scanDate.slice(0, 10),
    agentName: agentConfig.name,
    reportText: response.text,
  });

  const pdfFilename = `tilt-competitor-social-${scrapeResult.scanDate.slice(0, 10)}.pdf`;

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
      id: `competitor-social-${startedAt.toISOString()}`,
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

  return {
    report: response.text,
    scanDate: scrapeResult.scanDate,
    postsScraped: {
      instagram: scrapeResult.instagramPostCount,
      tiktok: scrapeResult.tiktokPostCount,
    },
    tokens: { input: response.inputTokens, output: response.outputTokens },
    emailSentTo: emailTo,
  };
}
