// ---------------------------------------------------------------------------
// org/rhythm.ts — the company's operating rhythm.
//
// The fix for "everyone knows their job but waits to be asked": each dormant
// role gets a standing cadence, run by the daily cron. Every job is a real
// work order through the engine (worker → boss review → Chris's queue) or a
// department dispatch, so output lands exactly where hand-assigned work does.
//
// Jobs are ON by default (Chris asked for this rhythm) and individually
// switchable from the /org page — settings live in KV so a toggle survives
// deploys. A job that has nothing to do (e.g. no open team orders) skips
// silently instead of filing an empty report.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import { createWorkOrder } from "./work-orders";
import { runWorkOrder } from "./engine";
import { runDepartmentDispatch } from "./dispatch";
import { isDispatchDue } from "./dispatch-cadence";
import { fetchTeamOrders } from "../sales/team-orders";

const SETTINGS_KEY = "org-rhythm-settings";

export interface RhythmJob {
  id: string;
  label: string;
  /** Human-readable schedule shown in the UI. */
  schedule: string;
  description: string;
  /** Should this job fire on this cron tick? (Cron runs daily ~8 AM ET.) */
  isDue: (now: Date) => boolean;
  /** Do the work. Return a one-line outcome ("skipped — nothing open" is fine). */
  run: () => Promise<string>;
}

/**
 * First weekday of the month, exactly once: the 1st when it's a weekday,
 * otherwise the following Monday (the 2nd or 3rd).
 */
function isMonthlyTick(now: Date): boolean {
  const dom = now.getUTCDate();
  const day = now.getUTCDay();
  if (day < 1 || day > 5) return false;
  return dom === 1 || (day === 1 && dom <= 3);
}

async function runOrderFor(
  departmentId: string,
  assigneeId: string,
  title: string,
  brief: string
): Promise<string> {
  const order = await createWorkOrder({
    departmentId,
    assigneeId,
    title,
    brief,
    createdBy: "Company rhythm",
  });
  const result = await runWorkOrder(order.id);
  return `work order "${title}" → ${result.order.status}`;
}

export const RHYTHM_JOBS: RhythmJob[] = [
  {
    id: "reese-brief",
    label: "Reese — Monday founder briefing",
    schedule: "Mondays",
    description:
      "Reese reads the whole company — the founders' queue, every department's week — and files his ranked briefing in your review queue.",
    isDue: (now) => now.getUTCDay() === 1,
    run: () =>
      runOrderFor(
        "executive",
        "chief-of-staff",
        `Founder briefing — week of ${new Date().toISOString().slice(0, 10)}`,
        "Produce this week's founder briefing from the founders' queue and the last week of company activity in your context: decisions needed now (ranked, each with your recommendation), shipped/moving, stuck or at risk, and this week's few."
      ),
  },
  {
    id: "bizdev-weekly",
    label: "Brooks — weekly prospecting sweep",
    schedule: "Tuesdays",
    description:
      "Brooks plans the week and dispatches the bizdev team — fresh researched leads, qualified and with outreach drafts, into your queue.",
    isDue: (now) => now.getUTCDay() === 2,
    run: async () => {
      // Respect manual runs: if someone dispatched bizdev in the last 6 days,
      // don't pile a second round on top.
      if (!(await isDispatchDue("bizdev", 6))) return "skipped — dispatched recently";
      const result = await runDepartmentDispatch("bizdev");
      return `dispatched ${result.dispatched} piece${result.dispatched === 1 ? "" : "s"}`;
    },
  },
  {
    id: "sales-orders-weekly",
    label: "Jules — team-order sweep",
    schedule: "Thursdays (skips when no orders)",
    description:
      "Jules consolidates any open team-store orders into vendor-ready emails in Jeremy's voice. Skips silently when nothing's open.",
    isDue: (now) => now.getUTCDay() === 4,
    run: async () => {
      const res = await fetchTeamOrders();
      if ("error" in res) throw new Error(`team-orders feed: ${res.error}`);
      if (res.orders.length === 0) return "skipped — no open team orders";
      return runOrderFor(
        "sales",
        "team-sales-coordinator",
        `Team-order consolidation — ${res.orders.length} open order${res.orders.length === 1 ? "" : "s"}`,
        "Consolidate every open team-store order in your context into vendor-ready email packages (one email per product per vendor, Jeremy's voice, complete size breakdowns). Flag anything blocked or ambiguous instead of guessing."
      );
    },
  },
  {
    id: "consignment-monthly",
    label: "Reeve — monthly consignment audit",
    schedule: "First weekday of the month",
    description:
      "Reeve cross-references billable consignment months against real Zoho invoices and reports any month that was never billed.",
    isDue: isMonthlyTick,
    run: () =>
      runOrderFor(
        "sales",
        "retailer-auditor",
        `Consignment billing audit — ${new Date().toISOString().slice(0, 7)}`,
        "Audit consignment billing: compare the billable months in your context against the actual Zoho invoices and list every retailer-month that should have been invoiced but wasn't, with amounts. If everything is billed, say so in one line."
      ),
  },
  {
    id: "cash-outlook-monthly",
    label: "June — monthly cash outlook",
    schedule: "First weekday of the month",
    description:
      "June turns the live books into runway, burn, and the month's key variances — reviewed by Sterling before it reaches you.",
    isDue: isMonthlyTick,
    run: () =>
      runOrderFor(
        "finance",
        "cash-flow-analyst",
        `Cash outlook — ${new Date().toISOString().slice(0, 7)}`,
        "Produce the monthly cash outlook from the live books in your context: weeks of runway at current burn, cash in/out for the last 30 days, the biggest variances vs the prior month, and the one decision the numbers imply. Show the math and tag confidence."
      ),
  },
];

// ---- settings ---------------------------------------------------------------

export async function getRhythmSettings(): Promise<Record<string, boolean>> {
  const stored = await kv.get<Record<string, boolean>>(SETTINGS_KEY);
  const settings: Record<string, boolean> = {};
  for (const job of RHYTHM_JOBS) settings[job.id] = stored?.[job.id] !== false; // default ON
  return settings;
}

export async function setRhythmSetting(id: string, on: boolean): Promise<void> {
  const stored = (await kv.get<Record<string, boolean>>(SETTINGS_KEY)) ?? {};
  stored[id] = on;
  await kv.set(SETTINGS_KEY, stored);
}

// ---- cron entry -------------------------------------------------------------

/** Every enabled job due on this tick, ready for the cron's task list. */
export async function getDueRhythmJobs(now: Date): Promise<RhythmJob[]> {
  const settings = await getRhythmSettings().catch(
    () => Object.fromEntries(RHYTHM_JOBS.map((j) => [j.id, true])) as Record<string, boolean>
  );
  return RHYTHM_JOBS.filter((j) => settings[j.id] !== false && j.isDue(now));
}
