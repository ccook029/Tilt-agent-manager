// ---------------------------------------------------------------------------
// POST /api/inventory/run — On-demand inventory management tasks
//
// Body:
//   {
//     "task": "stock-alert" | "po-recommendation" | "sku-audit" | "shipment-tracker" | "inventory-reconciliation",
//     "context": "Inventory data or description of the concern",
//     "product_name": "Optional project name for email subject",
//     "email": true | false  // whether to email the result (default: true)
//   }
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { callClaude, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport, sendErrorNotification } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import { fetchInventorySnapshot } from "@/lib/zoho";
import { fetchSheetSnapshot } from "@/lib/zoho-sheet";
import { fetchSyncReport, applyStockAdjustments, zeroNegativeStock } from "@/lib/zoho-sync";
import agentConfig from "@/agents/inventory-agent.config";

export const maxDuration = 300;

const TASK_LABELS: Record<string, string> = {
  "stock-alert": "Stock Alert",
  "po-recommendation": "PO Recommendation",
  "sku-audit": "SKU Audit",
  "shipment-tracker": "Shipment Tracker",
  "inventory-reconciliation": "Inventory Reconciliation",
  "sheet-reconciliation": "Sheet ↔ Inventory Reconciliation",
  "sheet-sync": "Sheet → Inventory Sync",
  "zero-negative": "Zero Negative Stock",
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      task,
      context,
      product_name = "Inventory",
      email: sendEmail = true,
    } = body as {
      task: string;
      context: string;
      product_name?: string;
      email?: boolean;
    };

    // Validate task type
    const taskPrompt = agentConfig.taskPrompts[task];
    if (!taskPrompt) {
      return NextResponse.json(
        {
          error: `Invalid task type: "${task}". Valid types: ${Object.keys(agentConfig.taskPrompts).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const startedAt = new Date();
    const taskLabel = TASK_LABELS[task] ?? task;

    // Fetch data based on task type
    let fullContext: string;

    if (task === "zero-negative") {
      // Zero out all negative stock_on_hand values
      const result = await zeroNegativeStock();
      fullContext = [
        "## Zero Negative Stock Results",
        result,
        context ? `\n## Additional Context\n${context}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    } else if (task === "sheet-sync") {
      // Apply stock adjustments — correct Inventory stock_on_hand to match the Sheet
      const syncResult = await applyStockAdjustments();
      fullContext = [
        "## Sheet → Inventory Sync Results",
        syncResult,
        context ? `\n## Additional Context\n${context}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    } else if (task === "sheet-reconciliation") {
      // Compare sheet vs inventory (read-only)
      const syncReport = await fetchSyncReport();
      fullContext = [
        "## Sheet ↔ Inventory Reconciliation Data",
        syncReport,
        context ? `\n## Additional Context\n${context}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    } else {
      // Standard tasks — fetch both Sheet and Inventory data
      const [inventoryData, sheetData] = await Promise.all([
        fetchInventorySnapshot(),
        fetchSheetSnapshot().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[inventory/run] Sheet snapshot failed for task="${task}":`, msg);
          return `## ⚠️ Zoho Sheet Data Unavailable\n\nError: ${msg}\n\nThe master spreadsheet could not be loaded. Operating on Zoho Inventory data only.`;
        }),
      ]);
      fullContext = [
        "## Live Zoho Inventory Data",
        inventoryData,
        sheetData ? `\n${sheetData}` : "",
        context ? `\n## Additional Context\n${context}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    // Build the user message
    const variables: Record<string, string> = {
      context: fullContext,
      product_name: product_name,
      task_label: taskLabel,
    };

    const userMessage = substituteVariables(taskPrompt, variables);

    // Call Claude
    const response = await callClaude({
      systemPrompt: agentConfig.systemPrompt,
      userMessage,
      model: agentConfig.model,
      maxTokens: agentConfig.maxTokens,
      temperature: agentConfig.temperature,
    });

    // Generate branded PDF
    const pdfBuffer = await generateReportPDF({
      title: taskLabel,
      subtitle: product_name,
      reportDate: startedAt.toISOString().slice(0, 10),
      agentName: agentConfig.name,
      reportText: response.text,
    });

    const safeName = product_name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const pdfFilename = `tilt-inventory-${task}-${safeName}-${startedAt.toISOString().slice(0, 10)}.pdf`;

    // Email the result if requested
    if (sendEmail) {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      const emailFrom = agentConfig.email.from;
      const emailSubject = substituteVariables(
        agentConfig.email.subjectTemplate,
        variables
      );

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

    // Persist to dashboard
    await saveRunLogs([
      {
        id: `inventory-${task}-${startedAt.toISOString()}`,
        agentId: agentConfig.id,
        agentName: `${agentConfig.name} (${taskLabel})`,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status: "success",
        output: response.text,
        model: agentConfig.model,
        tokensUsed: response.inputTokens + response.outputTokens,
      },
    ]);

    return NextResponse.json({
      ok: true,
      task,
      taskLabel,
      productName: product_name,
      report: response.text,
      tokens: {
        input: response.inputTokens,
        output: response.outputTokens,
      },
      emailSent: sendEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[inventory/run] Failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[inventory/run] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
