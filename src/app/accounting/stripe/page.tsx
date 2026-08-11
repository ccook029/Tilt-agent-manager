"use client";

// ---------------------------------------------------------------------------
// /accounting/stripe — Stripe ⇄ Zoho Books reconciliation console.
//
// Penny reads Stripe (read-only), matches every card sale to its Zoho invoice
// via the PaymentIntent id, and proposes the postings that are missing. Nothing
// hits the books until you approve it.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

type ProposalKind = "payment" | "fee" | "transfer";

interface Proposal {
  id: string;
  kind: ProposalKind;
  summary: string;
  debit: string;
  credit: string;
  amount: number;
  date: string;
  stripeRef: string;
  status: "pending" | "approved" | "rejected" | "failed";
  error?: string;
}

interface PayoutRecon {
  payoutId: string;
  arrivalDate: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  charges: Array<{
    chargeId: string;
    reference: string;
    grossCents: number;
    invoiceNumber?: string;
    customerEmail?: string;
    state: "settled" | "payment_missing" | "invoice_missing";
  }>;
  bankTxnId?: string;
  notes: string[];
}

interface Run {
  generatedAt: string;
  windowDays: number;
  since: string;
  accounts: {
    clearingName: string;
    bankName: string;
    feeName: string;
    feeTaxName?: string;
    problems: string[];
  };
  payouts: PayoutRecon[];
  summary: {
    payouts: number;
    charges: number;
    settled: number;
    paymentsMissing: number;
    invoicesMissing: number;
    grossDollars: number;
    feeDollars: number;
    netDollars: number;
    unmatchedBankLines: number;
  };
  warnings: string[];
}

const KIND_LABEL: Record<ProposalKind, string> = {
  payment: "Mark invoice paid",
  fee: "Stripe fees",
  transfer: "Payout to bank",
};

const KIND_BLURB: Record<ProposalKind, string> = {
  payment:
    "The card cleared but the invoice never got its payment. Money lands in clearing, not the bank — Stripe is still holding it.",
  fee: "Stripe's cut for the payout, expensed through the clearing account so the bank line still matches to the penny.",
  transfer:
    "The payout itself: clearing → bank. A transfer, never revenue — the sale was already recognized when the invoice was raised.",
};

const money = (n: number) =>
  n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

const cents = (n: number) => money(n / 100);

export default function StripeReconPage() {
  const [run, setRun] = useState<Run | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [showDetail, setShowDetail] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/stripe-recon");
      const data = await res.json();
      setRun(data.run ?? null);
      setProposals(data.proposals ?? []);
      if (!data.configured) {
        setNote(
          "STRIPE_SECRET_KEY isn't set on the hub. Add a restricted, read-only Stripe key and redeploy."
        );
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/accounting/stripe-recon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function reconcile() {
    setRunning(true);
    setNote(null);
    try {
      const data = await post({ mode: "run", days });
      if (data.error) setNote(data.error);
      setRun(data.run ?? null);
      setProposals(data.proposals ?? []);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function decide(id: string, mode: "approve" | "reject") {
    setBusyId(id);
    try {
      const data = await post({ mode, id });
      setProposals(data.proposals ?? []);
      if (data.proposal?.error) setNote(data.proposal.error);
    } finally {
      setBusyId(null);
    }
  }

  async function approveKind(kind: ProposalKind) {
    setBusyId(kind);
    setNote(null);
    try {
      const data = await post({ mode: "approveAll", kinds: [kind] });
      setProposals(data.proposals ?? []);
      setNote(
        `Posted ${data.approved} entr${data.approved === 1 ? "y" : "ies"}` +
          (data.failed ? `, ${data.failed} failed — see the red cards below.` : ".")
      );
    } finally {
      setBusyId(null);
    }
  }

  const pending = proposals.filter((p) => p.status === "pending");
  const handled = proposals.filter((p) => p.status !== "pending");
  const byKind = (k: ProposalKind) => pending.filter((p) => p.kind === k);

  // The self-check: after posting, clearing should hold only in-transit money.
  const clearingDelta = run
    ? run.summary.grossDollars - run.summary.feeDollars - run.summary.netDollars
    : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight text-white">
            Stripe reconciliation
          </h1>
          <p className="mt-1 max-w-xl text-sm text-gray-400">
            Every card sale should post three times: invoice raised, card paid
            into <span className="text-gray-200">Stripe Clearing</span>, then the
            payout moving clearing into the bank less fees. Penny reads Stripe
            read-only, finds the legs that are missing, and proposes them here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-gray-500">
            Days
            <input
              className="mt-1 w-16 rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-xs text-gray-200 focus:border-[#00d6ff] focus:outline-none"
              value={days}
              inputMode="numeric"
              onChange={(e) => setDays(Number(e.target.value) || 90)}
            />
          </label>
          <button
            onClick={reconcile}
            disabled={running}
            className="rounded-lg bg-[#00d6ff] px-5 py-2.5 text-sm font-semibold text-[#06232b] transition-colors hover:bg-[#00a6c9] disabled:opacity-40"
          >
            {running ? "Reconciling…" : "Reconcile"}
          </button>
        </div>
      </header>

      {note && (
        <p className="rounded-lg border border-gray-800 bg-[#0d0d0d] px-4 py-2.5 text-sm text-gray-300">
          {note}
        </p>
      )}

      {run?.warnings?.map((w) => (
        <p
          key={w}
          className="rounded-lg border border-amber-900/50 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300"
        >
          {w}
        </p>
      ))}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !run ? (
        <p className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">
          No reconciliation yet. Hit{" "}
          <span className="text-gray-200">Reconcile</span> to walk the last{" "}
          {days} days of Stripe payouts against the books. Nothing is posted —
          you&apos;ll get a list of proposals to review.
        </p>
      ) : (
        <>
          {/* ---- Summary ---- */}
          <section className="rounded-xl border border-gray-800 bg-[#0d0d0d] p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {run.summary.payouts} payouts since {run.since}
              </h2>
              <span className="text-[11px] text-gray-600">
                run {new Date(run.generatedAt).toLocaleString("en-CA")}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <Stat label="Gross sales" value={money(run.summary.grossDollars)} />
              <Stat label="Stripe fees" value={money(run.summary.feeDollars)} />
              <Stat label="Net to bank" value={money(run.summary.netDollars)} />
            </div>

            <div className="mt-4 space-y-1.5 text-sm">
              <Line
                tone="good"
                text={`${run.summary.settled} card sales already posted correctly.`}
              />
              {run.summary.paymentsMissing > 0 && (
                <Line
                  tone="warn"
                  text={`${run.summary.paymentsMissing} invoices still show unpaid even though the card cleared — the payment leg leaked.`}
                />
              )}
              {run.summary.invoicesMissing > 0 && (
                <Line
                  tone="bad"
                  text={`${run.summary.invoicesMissing} charges have no Zoho invoice carrying their PaymentIntent id. These need you — Penny won't invent an invoice.`}
                />
              )}
              {run.summary.unmatchedBankLines > 0 && (
                <Line
                  tone="warn"
                  text={`${run.summary.unmatchedBankLines} payouts have no matching uncategorized deposit in ${run.accounts.bankName}. Either the feed hasn't caught up or they were categorized by hand.`}
                />
              )}
              <Line
                tone={Math.abs(clearingDelta) < 0.01 ? "good" : "bad"}
                text={
                  Math.abs(clearingDelta) < 0.01
                    ? `Arithmetic checks out: gross − fees = net, so ${run.accounts.clearingName} will clear to zero once these post.`
                    : `Gross − fees − net is off by ${money(clearingDelta)}. ${run.accounts.clearingName} won't fully clear — worth a look before posting.`
                }
              />
            </div>

            <p className="mt-4 border-t border-gray-800 pt-3 text-[11px] text-gray-500">
              Posting to {run.accounts.clearingName} → {run.accounts.bankName},
              fees to <span className="text-gray-400">{run.accounts.feeName}</span>
              {run.accounts.feeTaxName
                ? `, tax on fees as ${run.accounts.feeTaxName} when Stripe itemizes it`
                : ""}
              .
            </p>
          </section>

          {/* ---- Proposals ---- */}
          {pending.length === 0 ? (
            <p className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">
              Nothing to post — the window is fully reconciled.
            </p>
          ) : (
            (["payment", "fee", "transfer"] as ProposalKind[]).map((kind) => {
              const group = byKind(kind);
              if (group.length === 0) return null;
              const total = group.reduce((s, p) => s + p.amount, 0);
              return (
                <section key={kind} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        {KIND_LABEL[kind]}{" "}
                        <span className="text-gray-500">
                          · {group.length} · {money(total)}
                        </span>
                      </h2>
                      <p className="mt-0.5 max-w-xl text-[11px] text-gray-500">
                        {KIND_BLURB[kind]}
                      </p>
                    </div>
                    <button
                      onClick={() => approveKind(kind)}
                      disabled={busyId === kind}
                      className="rounded-lg border border-[#00d6ff]/40 bg-[#00d6ff]/10 px-3 py-1.5 text-xs font-semibold text-[#00d6ff] hover:bg-[#00d6ff]/20 disabled:opacity-40"
                    >
                      {busyId === kind ? "Posting…" : `Post all ${group.length}`}
                    </button>
                  </div>

                  {group.map((p) => (
                    <ProposalCard
                      key={p.id}
                      p={p}
                      busy={busyId === p.id}
                      onDecide={decide}
                    />
                  ))}
                </section>
              );
            })
          )}

          {/* ---- Payout detail ---- */}
          <div className="pt-2">
            <button
              onClick={() => setShowDetail((s) => !s)}
              className="text-xs text-[#00d6ff] hover:text-[#7be9ff]"
            >
              {showDetail ? "Hide" : "Show"} payout-by-payout detail
            </button>
          </div>

          {showDetail && (
            <div className="space-y-2">
              {run.payouts.map((po) => (
                <div
                  key={po.payoutId}
                  className="rounded-lg border border-gray-800/60 bg-[#0d0d0d] p-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-gray-300">
                      {po.arrivalDate} · {cents(po.netCents)} to bank
                    </span>
                    <span className="text-gray-500">
                      {po.charges.length} sales · gross {cents(po.grossCents)} ·
                      fees {cents(po.feeCents)}
                      {po.bankTxnId ? " · bank line matched" : " · no bank line"}
                    </span>
                  </div>
                  {po.notes.map((n) => (
                    <p key={n} className="mt-1.5 text-[11px] text-amber-400/80">
                      {n}
                    </p>
                  ))}
                  <div className="mt-2 space-y-0.5">
                    {po.charges.map((c) => (
                      <div
                        key={c.chargeId}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="truncate text-gray-500">
                          {c.invoiceNumber ?? c.reference}
                          {c.customerEmail ? ` · ${c.customerEmail}` : ""}
                        </span>
                        <span
                          className={
                            c.state === "settled"
                              ? "text-green-500"
                              : c.state === "payment_missing"
                                ? "text-amber-400"
                                : "text-red-400"
                          }
                        >
                          {cents(c.grossCents)} ·{" "}
                          {c.state === "settled"
                            ? "ok"
                            : c.state === "payment_missing"
                              ? "unpaid"
                              : "no invoice"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {handled.length > 0 && (
        <div className="space-y-2 pt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Handled
          </h2>
          {handled.map((p) => (
            <div
              key={p.id}
              className={`rounded-lg border px-4 py-2 text-xs ${
                p.status === "failed"
                  ? "border-red-900/50 bg-red-500/10 text-red-300"
                  : "border-gray-800/50 bg-[#0d0d0d] text-gray-400"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{p.summary}</span>
                <span className="shrink-0">{p.status}</span>
              </div>
              {p.error && <p className="mt-1 text-[11px]">{p.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800/60 bg-[#111]/40 px-2 py-3">
      <div className="text-base font-semibold text-white">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </div>
    </div>
  );
}

function Line({ tone, text }: { tone: "good" | "warn" | "bad"; text: string }) {
  const color =
    tone === "good"
      ? "text-green-400"
      : tone === "warn"
        ? "text-amber-400"
        : "text-red-400";
  return (
    <p className="flex gap-2 text-gray-300">
      <span className={color}>•</span>
      <span>{text}</span>
    </p>
  );
}

function ProposalCard({
  p,
  busy,
  onDecide,
}: {
  p: Proposal;
  busy: boolean;
  onDecide: (id: string, mode: "approve" | "reject") => void;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-[#0d0d0d] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-200">{p.summary}</p>
          <p className="mt-1.5 font-mono text-[11px] text-gray-500">
            Dr {p.debit} · Cr {p.credit}
          </p>
          <p className="mt-1 text-[11px] text-gray-600">
            {p.date} · {p.stripeRef}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => onDecide(p.id, "approve")}
            disabled={busy}
            className="rounded-lg bg-[#00d6ff] px-3 py-1.5 text-xs font-semibold text-[#06232b] hover:bg-[#00a6c9] disabled:opacity-40"
          >
            {busy ? "…" : "Post"}
          </button>
          <button
            onClick={() => onDecide(p.id, "reject")}
            disabled={busy}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-200 disabled:opacity-40"
          >
            Skip
          </button>
        </div>
      </div>
      {p.error && (
        <p className="mt-2 rounded-md border border-red-900/50 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
          {p.error}
        </p>
      )}
    </div>
  );
}
