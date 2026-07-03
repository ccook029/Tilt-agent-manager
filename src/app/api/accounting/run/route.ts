import { CLAUDE_MODEL } from "@/lib/models";
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
import { runAccountingCycle, runWorkerTask } from "@/lib/accounting-loop";
import { runCategorizationBatch } from "@/lib/accounting-execute";
import { addEscalations } from "@/lib/policy-ledger";
import workerConfig from "@/agents/accounting-agent.config";

export const maxDuration = 300;

// Planning/diagnostic tasks run as a SINGLE model call (Penny only) so they
// finish well within serverless time limits — there are no real decisions for
// the CFO to resolve on a read-only assessment. The two-call worker→CFO review
// cycle runs for the action tasks that actually generate decision requests.
const WORKER_ONLY = new Set(["books-health", "catch-up-plan"]);

const TASK_LABELS: Record<string, string> = {
  "auto-categorize": "Auto-Categorize (Wave 1)",
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

    // Wave 1 execution: autonomous categorization of the uncategorized backlog.
    // Runs a batch (LIVE if MCP write tools are connected, else a dry run).
    if (task === "auto-categorize") {
      const started = new Date();
      const result = await runCategorizationBatch({ limit: 15 });
      await saveRunLogs([
        {
          id: `accounting-execute-${result.batchId}`,
          agentId: "accounting",
          agentName: `Penny Quill (Auto-Categorize${result.mode === "proposed" ? " — Dry Run" : ""})`,
          startedAt: started.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - started.getTime(),
          status: "success",
          output: result.report,
          model: CLAUDE_MODEL,
        },
      ]);
      return NextResponse.json({ ok: true, task, ...result });
    }

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

    let report: string;
    let newEscalations: Awaited<ReturnType<typeof runAccountingCycle>>["newEscalations"] = [];
    let tokensUsed = 0;

    if (WORKER_ONLY.has(task)) {
      // Single fast call — Penny's diagnostic only. Her decision requests are
      // routed straight into the escalation queue so they surface for Chris to
      // answer in Sterling's chat panel + the daily digest (and become policy).
      const worker = await runWorkerTask(task, context);
      newEscalations = await addEscalations(
        worker.decisionRequests
          .map((d) => ({
            question: String(d.description ?? d.question ?? "").trim(),
            reason: `Raised by Penny during ${taskLabel}`,
            recommendation: d.recommendation ? String(d.recommendation) : undefined,
            dollarAmount: typeof d.dollar_amount === "number" ? d.dollar_amount : undefined,
          }))
          .filter((e) => e.question.length > 0)
      );
      report = [
        `# ${taskLabel}`,
        "",
        "## Staff Accountant — Penny Quill",
        worker.output,
        "",
        newEscalations.length > 0
          ? `> ⚠️ ${newEscalations.length} question(s) sent to your CFO chat for a decision — open Sterling Vance → Talk to Sterling.`
          : "",
      ].join("\n");
      tokensUsed = worker.inputTokens + worker.outputTokens;
    } else {
      // Full worker → CFO review cycle.
      const cycle = await runAccountingCycle(task, context);
      newEscalations = cycle.newEscalations;
      tokensUsed = cycle.tokens.input + cycle.tokens.output;
      report = [
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
    }

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
        tokensUsed,
      },
    ]);

    return NextResponse.json({
      ok: true,
      task,
      taskLabel,
      report,
      escalations: newEscalations,
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
