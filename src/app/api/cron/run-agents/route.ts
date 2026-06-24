// ---------------------------------------------------------------------------
// GET /api/cron/run-agents — Single Vercel Cron endpoint
//
// Runs daily at 12:00 UTC (8 AM ET). Dispatches the right agent pipelines
// based on the current day of the week:
//
//   Mon–Fri:  Website Analytics (daily report)
//   Monday:   Competitor Social, Inventory Weekly, Product Design Innovation
//   Wednesday: Competitor Intel
//   Friday:   Materials R&D Research
//
// This single-cron approach works on any Vercel plan (Hobby or Pro).
// Individual routes still work for manual triggers via POST.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { sendErrorNotification } from "@/lib/email";
import { runDailyReport } from "@/lib/pipelines/analytics";
import { runCompetitorReport } from "@/lib/pipelines/competitors";
import { runSocialIntelReport } from "@/lib/pipelines/competitor-social";
import { runInventoryWeeklyReport } from "@/lib/pipelines/inventory";
import { runAutoReconciliation } from "@/lib/pipelines/reconciliation";
import { runFactoryReorder } from "@/lib/pipelines/factory-reorder";
import { runResearchScan } from "@/lib/pipelines/materials-rd";
import { runInnovation } from "@/lib/pipelines/product-design";
import { sendCfoDigestEmail } from "@/lib/accounting-loop";

export const maxDuration = 300;

interface PipelineTask {
  name: string;
  run: () => Promise<unknown>;
}

/** Get ISO week number (1-53) for biweekly scheduling. */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getScheduledTasks(now: Date): PipelineTask[] {
  const tasks: PipelineTask[] = [];
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const hour = now.getUTCHours();

  // Early Monday (3 AM UTC = Sunday 11 PM ET): Factory Reorder (biweekly)
  // Runs on even ISO weeks — adjust the parity if the first order falls on an odd week
  if (day === 1 && hour < 6) {
    const week = getISOWeekNumber(now);
    if (week % 2 === 0) {
      tasks.push({ name: "Factory Reorder", run: () => runFactoryReorder() });
    }
    return tasks; // Don't run daily agents on the Sunday-night cron
  }

  // CFO Daily Digest: every day — Sterling batches open questions for Chris.
  // Runs on the main daytime cron, not the Sunday-night factory-only run.
  tasks.push({ name: "CFO Daily Digest", run: () => sendCfoDigestEmail() });

  // Inventory Reconciliation: Mon–Fri — runs first to keep Zoho Inventory in sync with the Sheet
  if (day >= 1 && day <= 5) {
    tasks.push({ name: "Inventory Reconciliation", run: () => runAutoReconciliation() });
  }

  // Analytics: Mon–Fri (day 1–5)
  if (day >= 1 && day <= 5) {
    tasks.push({ name: "Website Analytics", run: () => runDailyReport() });
  }

  // Monday (day 1): Social, Inventory, Product Design
  if (day === 1) {
    tasks.push({ name: "Competitor Social", run: () => runSocialIntelReport() });
    tasks.push({ name: "Inventory Weekly", run: () => runInventoryWeeklyReport() });
    tasks.push({ name: "Product Design Innovation", run: () => runInnovation() });
  }

  // Wednesday (day 3): Competitor Intel
  if (day === 3) {
    tasks.push({ name: "Competitor Intel", run: () => runCompetitorReport() });
  }

  // Friday (day 5): Materials R&D
  if (day === 5) {
    tasks.push({ name: "Materials R&D Research", run: () => runResearchScan() });
  }

  return tasks;
}

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const tasks = getScheduledTasks(now);

  if (tasks.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No agents scheduled for this run",
      day,
    });
  }

  // Run each pipeline sequentially to stay within memory/timeout limits
  const results: { name: string; status: "success" | "error"; error?: string }[] = [];

  for (const task of tasks) {
    try {
      await task.run();
      results.push({ name: task.name, status: "success" });
      console.log(`[cron] ${task.name}: success`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: task.name, status: "error", error: message });
      console.error(`[cron] ${task.name}: failed —`, message);

      // Try to send error notification
      try {
        const emailTo =
          process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
          ["chris@tilthockey.com"];
        await sendErrorNotification(
          emailTo,
          "Tilt Agents <agents@tilthockey.com>",
          `${task.name} pipeline failed:\n\n${message}`,
          task.name
        );
      } catch {
        console.error(`[cron] Error notification for ${task.name} also failed`);
      }
    }
  }

  const allOk = results.every((r) => r.status === "success");

  return NextResponse.json({
    ok: allOk,
    day,
    date: now.toISOString(),
    results,
  });
}
