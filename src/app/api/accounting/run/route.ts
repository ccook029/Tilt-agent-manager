// ---------------------------------------------------------------------------
// POST /api/accounting/run — Run a worker → CFO accounting cycle
//
// Body:
//   {
//     "task": "books-health" | "categorize-transactions" | "coa-audit" |
//             "ar-cleanup" | "ap-cleanup" | "inventory-tieout" |
//             "sales-tax-review" | "monthly-close",
//     "context": "optional extra context",
//     "email": true | false   // email the result (default: true)
//   }
//
// GET (no body) defaults to the read-only "books-health" report — the right
// first thing to run.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { sendAnalyticsReport, sendErrorNotification } from "@/lib/email";
import { saveRunLogs } from "@/lib/store";
import { generateReportPDF } from "@/lib/pdf";
import { runAccountingCycle } from "@/lib/accounting-loop";
import workerConfig from "@/agents/accounting-agent.config";

export const maxDuration = 300;

const TASK_LABELS: Record<string, string> = {
  "books-health": "Books Health Report",
  "catch-up-plan": "Catch-Up Roadmap",
  "bank-reconciliation": "Bank Reconciliation",
  "categorize-transactions": "Transaction Categorization",
  "coa-audit": "Chart of Accounts Audit",
  "ar-cleanup": "A/R Cleanup",
  "ap-cleanup": "A/P Cleanup",
  "inventory-tieout": "Inventory ↔ Books Tie-Out",
  "sales-tax-review": "Sales Tax Review",
  "monthly-close": "Monthly Close",
};

export async function GET(request: NextRequest) {
  const task = request.nextUrl.searchParams.get("task") ?? "books-health";
  const fake = new NextRequest(request.url, {
    method: "POST",
    body: JSON.stringify({ task, email: true }),
    headers: { "Content-Type": "application/json" },
  });
  return POST(fake);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      task = "books-health",
      context = "",
      email: sendEmail = true,
    } = body as { task?: string; context?: string; email?: boolean };

    if (!workerConfig.taskPrompts[task]) {
      return NextResponse.json(
        {
          error: `Invalid task "${task}". Valid: ${Object.keys(workerConfig.taskPrompts).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const startedAt = new Date();
    const taskLabel = TASK_LABELS[task] ?? task;

    const cycle = await runAccountingCycle(task, context);

    // Combined report = CFO review on top of Penny's work.
    const report = [
      `# ${taskLabel}`,
      "",
      "## CFO Review — Sterling Vance",
      cycle.cfoReview,
      "",
      "---",
      "",
      "## Staff Accountant Work — Penny Quill",
      cycle.workerOutput,
      "",
      cycle.newEscalations.length > 0
        ? `> ⚠️ ${cycle.newEscalations.length} question(s) escalated to Chris — see the next CFO digest or the HQ chat.`
        : "> ✅ No questions needed escalating — all handled by the CFO.",
    ].join("\n");

    const pdfBuffer = await generateReportPDF({
      title: taskLabel,
      subtitle: "Accounting — Sterling Vance & Penny Quill",
      reportDate: startedAt.toISOString().slice(0, 10),
      agentName: "Tilt Accounting",
      reportText: report,
    });
    const pdfFilename = `tilt-accounting-${task}-${startedAt.toISOString().slice(0, 10)}.pdf`;

    if (sendEmail) {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        workerConfig.email.to;
      await sendAnalyticsReport({
        to: emailTo,
        from: workerConfig.email.from,
        subject: `Accounting — ${taskLabel}`,
        reportText: report,
        pdfBuffer,
        pdfFilename,
      });
    }

    const finishedAt = new Date();

    await saveRunLogs([
      {
        id: `accounting-${task}-${startedAt.toISOString()}`,
        agentId: "accounting",
        agentName: `Penny Quill (${taskLabel})`,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status: "success",
        output: report,
        model: workerConfig.model,
        tokensUsed: cycle.tokens.input + cycle.tokens.output,
      },
    ]);

    return NextResponse.json({
      ok: true,
      task,
      taskLabel,
      report,
      escalations: cycle.newEscalations,
      emailSent: sendEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[accounting/run] Failed:", message);
    try {
      const emailTo =
        process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
        workerConfig.email.to;
      await sendErrorNotification(emailTo, workerConfig.email.from, message, "Accounting Agent");
    } catch {
      /* best effort */
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
