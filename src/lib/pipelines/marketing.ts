// ---------------------------------------------------------------------------
// pipelines/marketing.ts — Harper runs the week
//
// Thin wrapper over the generic department dispatch (org/dispatch.ts): Harper
// (Marketing Director) plans against the brand bar, live content plan, intel,
// and GA4/GSC, then dispatches work orders to her team; each runs through the
// engine and lands in Chris's approval queue. Marketing-specific planning
// guidance lives in dispatch.ts's DISPATCH_INSTRUCTIONS.
//
// Cron cadence: opt-in via MARKETING_CRON=true, every MARKETING_CRON_EVERY_DAYS
// days (default 3); manual runs from /review reset the clock.
// ---------------------------------------------------------------------------
import { runDepartmentDispatch, type DispatchResult } from "../org/dispatch";

export type MarketingWeeklyResult = DispatchResult;

export async function runMarketingWeekly(
  opts: { maxPieces?: number; run?: boolean } = {}
): Promise<MarketingWeeklyResult> {
  return runDepartmentDispatch("marketing", opts);
}
