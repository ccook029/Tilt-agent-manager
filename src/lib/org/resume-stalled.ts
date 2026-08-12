// ---------------------------------------------------------------------------
// org/resume-stalled.ts — pick up work that stopped mid-flight.
//
// The engine runs worker → boss review → (revise → worker again) inside ONE
// request, up to 3 rounds. That's several model calls against a 300s function
// limit, so a long brief can be cut off partway. When that happens the order is
// left in "revision" — a status runWorkOrder is happy to resume from, except
// nothing ever calls it again. It waits forever.
//
// That's the failure this whole board was built to expose: work that stops
// existing without anyone being told. So the cron sweeps for it.
// ---------------------------------------------------------------------------
import { listWorkOrders } from "./work-orders";
import { runWorkOrder } from "./engine";
import { hoursSince } from "./work-status";
import { postSignal } from "../signals";

/** Leave a genuinely in-flight run alone; only touch what has clearly stopped. */
const STALLED_AFTER_HOURS = 1;
/** A cron tick has other work to do — don't spend the whole budget here. */
const MAX_PER_RUN = 3;

export interface ResumeSummary {
  found: number;
  resumed: number;
  failed: number;
}

export async function resumeStalledWorkOrders(): Promise<ResumeSummary> {
  const summary: ResumeSummary = { found: 0, resumed: 0, failed: 0 };

  // Only the two states the engine will accept. Anything else — in_review,
  // approved, escalated — is either genuinely moving or waiting on a human.
  const candidates = await listWorkOrders({
    status: ["queued", "revision"],
    limit: 100,
  }).catch(() => []);

  const stalled = candidates.filter(
    (o) => hoursSince(o.updatedAt) >= STALLED_AFTER_HOURS
  );
  summary.found = stalled.length;
  if (stalled.length === 0) return summary;

  for (const order of stalled.slice(0, MAX_PER_RUN)) {
    try {
      await runWorkOrder(order.id);
      summary.resumed++;
      console.log(`[resume-stalled] picked up ${order.id} — "${order.title}"`);
    } catch (err) {
      summary.failed++;
      console.error(
        `[resume-stalled] ${order.id} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (summary.resumed > 0 || summary.failed > 0) {
    await postSignal({
      source: "org",
      headline: `Picked up ${summary.resumed} stalled work order${
        summary.resumed === 1 ? "" : "s"
      }${summary.failed ? ` (${summary.failed} still failing)` : ""}`,
      detail:
        `These had stopped mid-run — the engine's rounds happen inside one ` +
        `request, so a timeout leaves them parked. ` +
        `${summary.found} were sitting ${STALLED_AFTER_HOURS}h+ without moving.`,
    }).catch(() => {});
  }

  return summary;
}
