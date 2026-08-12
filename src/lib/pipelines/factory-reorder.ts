// ---------------------------------------------------------------------------
// Pipeline: Biweekly factory reorder recommendation — powered by Stockton
// ---------------------------------------------------------------------------
import { callClaudeToCompletion, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport, perAgentEmailsEnabled } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import { fetchFactoryReorderData } from "@/lib/factory-reorder";
import agentConfig from "@/agents/inventory-agent.config";
import { renderOrgKnowledge } from "@/lib/org-knowledge";
import { postSignal } from "@/lib/signals";
import { headlineFrom } from "@/lib/signal-headline";
import { addEscalations } from "@/lib/org/ledger";

/** The order totals Stockton appends as a ```reorder block. */
interface ReorderTotals {
  totalSticks?: number;
  totalCost?: number;
  customSticks?: number;
  headline?: string;
}

/**
 * Pull the machine-readable totals off the end of the report and return the
 * report without them — the numbers drive the approval card, the prose is
 * what Jeremy and Chris actually read.
 */
function splitTotals(text: string): { report: string; totals: ReorderTotals | null } {
  const m = text.match(/```reorder\s*([\s\S]*?)```/);
  if (!m) return { report: text, totals: null };
  const report = text.replace(m[0], "").trimEnd();
  try {
    return { report, totals: JSON.parse(m[1].trim()) as ReorderTotals };
  } catch {
    console.warn("[factory-reorder] could not parse the ```reorder totals block");
    return { report, totals: null };
  }
}

export async function runFactoryReorder(context?: string) {
  const startedAt = new Date();
  const reportDate = startedAt.toISOString().slice(0, 10);

  // Fetch all reorder data (stock levels, velocity, custom orders, open POs)
  const { report: reorderData, summary } = await fetchFactoryReorderData();

  const taskPrompt = agentConfig.taskPrompts["factory-reorder"];
  const variables: Record<string, string> = {
    context: reorderData + (context ? `\n\n## Additional Context\n${context}` : ""),
    date: reportDate,
    task_label: "Factory Reorder Recommendation",
  };

  const userMessage = substituteVariables(taskPrompt, variables);

  // To completion: the reorder report is seven sections of tables and was the
  // deliverable most likely to stop mid-sentence at the token ceiling.
  const response = await callClaudeToCompletion({
    systemPrompt: agentConfig.systemPrompt + (await renderOrgKnowledge()),
    userMessage,
    model: agentConfig.model,
    maxTokens: agentConfig.maxTokens,
    temperature: agentConfig.temperature,
  });

  const { report: reportText, totals } = splitTotals(response.text);

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
    reportText,
  });

  const pdfFilename = `tilt-factory-reorder-${reportDate}.pdf`;

  if (perAgentEmailsEnabled()) {
    await sendAnalyticsReport({
      to: emailTo,
      from: emailFrom,
      subject: emailSubject,
      reportText,
      pdfBuffer,
      pdfFilename,
    });
  }

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
      output: reportText,
      model: agentConfig.model,
      tokensUsed: response.inputTokens + response.outputTokens,
    },
  ]);

  await postSignal({
    source: "factory-reorder",
    headline: headlineFrom(reportText),
  }).catch(() => {});

  // A biweekly factory order is money out the door, so it belongs on /review
  // as a decision — not only in an emailed PDF that can go unread. Runs every
  // other week, and the date in the question keeps each cycle its own card.
  const sticks = totals?.totalSticks;
  const cost =
    typeof totals?.totalCost === "number"
      ? ` for about $${totals.totalCost.toLocaleString("en-CA", { maximumFractionDigits: 0 })}`
      : "";
  const question = totals?.totalSticks
    ? `Approve the ${reportDate} factory order — ${sticks} sticks${cost}?`
    : `Approve the ${reportDate} factory order?`;

  const caveats: string[] = [];
  if (summary.queueError) {
    caveats.push(
      `The custom queue was UNREACHABLE (${summary.queueError}), so committed custom demand is missing from this recommendation — fix that before ordering.`
    );
  }
  if (summary.unmatchedCustoms > 0) {
    caveats.push(
      `${summary.unmatchedCustoms} queued custom stick${summary.unmatchedCustoms === 1 ? "" : "s"} couldn't be matched to a SKU and ${summary.unmatchedCustoms === 1 ? "is" : "are"} listed separately in the report — check ${summary.unmatchedCustoms === 1 ? "it is" : "they are"} on the order.`
    );
  }

  await addEscalations("operations", [
    {
      question,
      reason: [
        totals?.headline || "Stockton's biweekly factory reorder recommendation is ready.",
        `${summary.totalCustomPending} custom stick${summary.totalCustomPending === 1 ? "" : "s"} pending on the factory queue · ${summary.burnRate14d} sold from stock in the last 14 days · ${summary.totalAvailable} available on the shelf.`,
        ...caveats,
        "Full breakdown is in the emailed PDF and the run log.",
      ].join("\n\n"),
      recommendation: totals?.totalSticks
        ? `Place the ${sticks}-stick order as recommended${cost}`
        : undefined,
      dollarAmount: totals?.totalCost,
    },
  ]).catch((err) => {
    console.warn(
      "[factory-reorder] could not raise the approval decision:",
      err instanceof Error ? err.message : err
    );
  });

  return {
    report: reportText,
    reportDate,
    tokens: { input: response.inputTokens, output: response.outputTokens },
    emailSentTo: emailTo,
  };
}
