// ---------------------------------------------------------------------------
// POST /api/product-design/run — On-demand product design tasks
//
// Body:
//   {
//     "task": "product-spec" | "rfq-package" | "catalog-update" | "rendering-brief" | "sell-sheet",
//     "context": "Description of the product or task details",
//     "product_name": "Optional product name for email subject",
//     "email": true | false  // whether to email the result (default: true)
//   }
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { callClaude, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport, sendErrorNotification } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import agentConfig from "@/agents/product-design-agent.config";

export const maxDuration = 300;

const TASK_LABELS: Record<string, string> = {
  "product-spec": "Product Specification",
  "rfq-package": "RFQ Package",
  "catalog-update": "Catalog Update",
  "rendering-brief": "Rendering Brief",
  "sell-sheet": "Sell Sheet",
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      task,
      context,
      product_name = "New Product",
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

    if (!context || !context.trim()) {
      return NextResponse.json(
        { error: "context is required — describe the product or task" },
        { status: 400 }
      );
    }

    const startedAt = new Date();
    const taskLabel = TASK_LABELS[task] ?? task;

    // Build the user message
    const variables: Record<string, string> = {
      context,
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
    const pdfFilename = `tilt-${task}-${safeName}-${startedAt.toISOString().slice(0, 10)}.pdf`;

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
        id: `product-design-${task}-${startedAt.toISOString()}`,
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
    console.error("[product-design/run] Failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[product-design/run] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
