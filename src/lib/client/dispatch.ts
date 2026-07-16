"use client";

// ---------------------------------------------------------------------------
// client/dispatch.ts — two-phase dispatch that never trips the 5-min timeout.
//
// The old flow ran the whole dispatch (boss plans + every work order runs
// through the engine) inside ONE request. Four pieces × a worker→boss cycle
// each blew past Vercel's 300s budget, so only the first couple finished.
//
// This splits it the way it should be:
//   1. PLAN — one fast request: the boss plans the period and creates the work
//      orders (status "queued"), but runs none of them (run:false).
//   2. RUN  — each queued order runs in its OWN request, one at a time. The KV
//      work-order store is a single read-modify-write key, so parallel runs
//      would clobber each other — sequential is required, and it also gives
//      clean live progress. Every order is comfortably under the per-request
//      limit, so all of them finish.
// ---------------------------------------------------------------------------

export interface DispatchProgress {
  phase: "planning" | "running" | "done";
  planned: number; // total pieces the boss created
  completed: number; // orders that have finished running
  approved: number;
  shipped: number;
  escalated: number;
  errored: number;
}

export interface DispatchOutcome {
  planned: number;
  approved: number; // boss-approved, waiting in the owner's review queue
  shipped: number; // auto-shipped (a graduated department ships without you)
  escalated: number;
  errored: number;
  error?: string;
}

/**
 * Plan a department's period, then run each work order in its own request.
 *
 * @param dispatchUrl  the plan endpoint — "/api/marketing/run" for Harper, or
 *                     "/api/org/departments/{id}/dispatch" for any boss.
 * @param opts.onProgress fires after planning and after every order, so the
 *                     caller can update its label and refresh its queue live.
 */
export async function dispatchInBackground(
  dispatchUrl: string,
  opts: {
    maxPieces?: number;
    onProgress?: (p: DispatchProgress) => void | Promise<void>;
  } = {}
): Promise<DispatchOutcome> {
  const { onProgress } = opts;

  // Phase 1 — plan only. The boss makes one call and creates the work orders.
  const planRes = await fetch(dispatchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run: false, maxPieces: opts.maxPieces }),
  });
  const plan = (await planRes.json().catch(() => ({}))) as {
    error?: string;
    workOrderIds?: string[];
  };
  if (!planRes.ok) {
    return {
      planned: 0,
      approved: 0,
      shipped: 0,
      escalated: 0,
      errored: 0,
      error: plan.error ?? "Dispatch planning failed.",
    };
  }

  const ids = plan.workOrderIds ?? [];
  const outcome: DispatchOutcome = {
    planned: ids.length,
    approved: 0,
    shipped: 0,
    escalated: 0,
    errored: 0,
  };
  await onProgress?.({
    phase: ids.length ? "running" : "done",
    planned: ids.length,
    completed: 0,
    approved: 0,
    shipped: 0,
    escalated: 0,
    errored: 0,
  });

  // Phase 2 — run each order in its own request, sequentially.
  for (let i = 0; i < ids.length; i++) {
    try {
      const res = await fetch(`/api/org/work-orders/${ids[i]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        order?: { status?: string };
      };
      const status = d.order?.status;
      if (status === "approved") outcome.approved += 1;
      else if (status === "shipped") outcome.shipped += 1;
      else if (status === "escalated") outcome.escalated += 1;
      else outcome.errored += 1; // error, or any non-terminal status = didn't land
    } catch {
      outcome.errored += 1;
    }
    await onProgress?.({
      phase: i + 1 >= ids.length ? "done" : "running",
      planned: ids.length,
      completed: i + 1,
      approved: outcome.approved,
      shipped: outcome.shipped,
      escalated: outcome.escalated,
      errored: outcome.errored,
    });
  }

  return outcome;
}
