// ---------------------------------------------------------------------------
// POST /api/tilt-design/run — On-demand Tilt Design tasks
//
// Body:
//   {
//     "task": "design-brief" | "blanket-design" | "catalog-layout"
//           | "canva-brief" | "social-creative" | "mockup-spec",
//     "context": "Description of the design or task details",
//     "project_name": "Optional project name for email subject",
//     "email": true | false  // whether to email the result (default: true)
//   }
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { callClaude, substituteVariables } from "@/lib/anthropic";
import { sendAnalyticsReport, sendErrorNotification } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import agentConfig from "@/agents/tilt-design-agent.config";

export const maxDuration = 300;

const TASK_LABELS: Record<string, string> = {
  "design-brief": "Design Brief",
  "blanket-design": "Blanket Design",
  "catalog-layout": "Catalog Layout",
  "canva-brief": "Canva Brief",
  "social-creative": "Social Creative",
  "mockup-spec": "Mockup Spec",
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      task,
      context,
      project_name = "New Design",
      email: sendEmail = true,
    } = body as {
      task: string;
      context: string;
      project_name?: string;
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
        { error: "context is required — describe the design or task" },
        { status: 400 }
      );
    }

    const startedAt = new Date();
    const taskLabel = TASK_LABELS[task] ?? task;

    // Build the user message
    const variables: Record<string, string> = {
      context,
      project_name,
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
      subtitle: project_name,
      reportDate: startedAt.toISOString().slice(0, 10),
      agentName: agentConfig.name,
      reportText: response.text,
    });

    const safeName = project_name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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
        id: `tilt-design-${task}-${startedAt.toISOString()}`,
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
      projectName: project_name,
      report: response.text,
      tokens: {
        input: response.inputTokens,
        output: response.outputTokens,
      },
      emailSent: sendEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tilt-design/run] Failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[tilt-design/run] Error notification also failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
