// ---------------------------------------------------------------------------
// POST|GET /api/product-design/innovate — Maya's autonomous innovation loop
//
// Generates a new product concept without user input. Designed to be called
// by a cron schedule (GET from Vercel Cron) or manually from the dashboard (POST).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/anthropic";
import { sendAnalyticsReport, sendErrorNotification } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import agentConfig from "@/agents/product-design-agent.config";

export const maxDuration = 300;

export async function POST() {
  try {
    const startedAt = new Date();

    const response = await callClaude({
      systemPrompt: agentConfig.systemPrompt,
      userMessage: agentConfig.innovationPrompt,
      model: agentConfig.model,
      maxTokens: agentConfig.maxTokens,
      temperature: 0.7, // higher creativity for innovation
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

    return NextResponse.json({
      ok: true,
      concept: response.text,
      tokens: {
        input: response.inputTokens,
        output: response.outputTokens,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[product-design/innovate] Failed:", message);

    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        agentConfig.email.to;
      await sendErrorNotification(emailTo, agentConfig.email.from, message);
    } catch (emailErr) {
      console.error("[product-design/innovate] Error notification failed:", emailErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel Cron calls GET
export async function GET(request: NextRequest) {
  // Verify cron auth if CRON_SECRET is set
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return POST();
}
