// ---------------------------------------------------------------------------
// /api/accounting/stripe-recon — Penny's Stripe ⇄ Zoho Books reconciliation.
//
// GET                              → last run + pending proposals
// GET ?diagnose=1                  → config check ONLY (no Stripe/Zoho writes,
//                                    no reconciliation) — safe to hit first
// POST { mode: "run", days }       → reconcile the window, build proposals
// POST { mode: "approve", id }     → post one proposal to Zoho
// POST { mode: "approveAll", kinds } → post every pending proposal
// POST { mode: "reject", id }      → dismiss a proposal
//
// Nothing here writes to Stripe — the Stripe client is GET-only by design.
// Auth: accounting owner (or cron).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_WINDOW_DAYS,
  approveAll,
  approveProposal,
  buildStripeRecon,
  getLastRun,
  listProposals,
  rejectProposal,
  resolveReconAccounts,
  type ProposalKind,
  type ReconAccounts,
} from "@/lib/stripe-recon";
import { describeStripeKey, stripeConfigured } from "@/lib/stripe";
import { guardAccountingOwner } from "@/lib/os-identity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;

  // Diagnose: confirm the wiring is right BEFORE anything reads Stripe or
  // proposes a posting. This is the first thing to hit on a fresh deploy.
  if (request.nextUrl.searchParams.get("diagnose")) {
    const key = describeStripeKey();
    const accounts: ReconAccounts = await resolveReconAccounts().catch((err) => ({
      clearingName: "",
      bankName: "",
      feeName: "",
      problems: [err instanceof Error ? err.message : String(err)],
    }));
    return NextResponse.json({
      ok: key.configured && accounts.problems.length === 0,
      stripe: {
        configured: key.configured,
        keyType: key.configured
          ? key.restricted
            ? "restricted (read-only) — recommended"
            : "full secret key — a restricted key would be safer"
          : "not set",
        mode: key.livemode ? "live" : "test",
        keyHint: key.hint,
      },
      accounts,
      readyToRun: key.configured && !!accounts.clearingId && !!accounts.bankId,
    });
  }

  const [run, proposals] = await Promise.all([
    getLastRun().catch(() => null),
    listProposals().catch(() => []),
  ]);

  return NextResponse.json({
    ok: true,
    configured: stripeConfigured(),
    defaultWindowDays: DEFAULT_WINDOW_DAYS,
    run,
    proposals,
  });
}

export async function POST(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    mode?: string;
    id?: string;
    days?: number;
    kinds?: ProposalKind[];
  };
  const mode = body.mode ?? "run";

  try {
    if (mode === "run") {
      // Cap the window so one request can't walk years of payouts inside a
      // serverless function.
      const days = Math.min(Math.max(body.days ?? DEFAULT_WINDOW_DAYS, 1), 365);
      const run = await buildStripeRecon({ windowDays: days });
      return NextResponse.json({ ok: true, run, proposals: run.proposals });
    }

    if (mode === "approve") {
      if (!body.id) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }
      const proposal = await approveProposal(body.id);
      return NextResponse.json({
        ok: proposal.status === "approved",
        proposal,
        proposals: await listProposals(),
      });
    }

    if (mode === "approveAll") {
      const result = await approveAll(body.kinds);
      return NextResponse.json({
        ok: result.failed === 0,
        ...result,
        proposals: await listProposals(),
      });
    }

    if (mode === "reject") {
      if (!body.id) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }
      await rejectProposal(body.id);
      return NextResponse.json({ ok: true, proposals: await listProposals() });
    }

    return NextResponse.json({ error: `Unknown mode "${mode}"` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
