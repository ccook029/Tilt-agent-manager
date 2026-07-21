"use client";

// ---------------------------------------------------------------------------
// /accounting/ap — Penny's AP Inbox review console.
//
// Scan pulls unprocessed bills from the Zoho Books Documents inbox and has Penny
// propose an entry; Chris approves each one (created in Zoho) or rejects it.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

interface Proposal {
  id: string;
  documentId: string;
  fileName: string;
  entryType: "bill" | "expense";
  vendor: string;
  date: string;
  reference?: string;
  amount: number;
  currency?: string;
  expenseAccount: string;
  paidThroughAccount?: string;
  alreadyPaid: boolean;
  paidVia?: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  duplicateOf?: string;
  status: "proposed" | "created" | "rejected" | "error";
  zohoNumber?: string;
  error?: string;
}

const confColor: Record<Proposal["confidence"], string> = {
  high: "text-green-400 border-green-900/50 bg-green-500/10",
  medium: "text-amber-400 border-amber-900/50 bg-amber-500/10",
  low: "text-red-400 border-red-900/50 bg-red-500/10",
};

export default function ApInboxPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/ap");
      const data = await res.json();
      setProposals(data.proposals ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const scan = async () => {
    setScanning(true);
    setNote(null);
    try {
      const res = await fetch("/api/accounting/ap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "scan", limit: 5 }),
      });
      const data = await res.json();
      setProposals(data.proposals ?? []);
      setNote(
        data.ok
          ? `Read ${data.scanned ?? 0} document(s).${data.skipped?.length ? ` Skipped: ${data.skipped.join(", ")}.` : ""}`
          : data.error ?? "Scan failed."
      );
    } catch {
      setNote("Scan failed — try again.");
    } finally {
      setScanning(false);
    }
  };

  const decide = async (
    id: string,
    mode: "approve" | "reject",
    force = false
  ) => {
    setBusyId(id);
    setNote(null);
    try {
      const res = await fetch("/api/accounting/ap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, id, force }),
      });
      const data = await res.json();
      setProposals(data.proposals ?? []);
      if (mode === "approve" && !data.ok) {
        setNote(
          data.blockedAsDuplicate
            ? "Held back — this looks like it's already in Zoho. Review it and hit “Create anyway” only if it's genuinely a new bill."
            : data.proposal?.error ?? "Couldn't create the entry in Zoho."
        );
      }
    } catch {
      setNote("Action failed — try again.");
    } finally {
      setBusyId(null);
    }
  };

  const open = proposals.filter((p) => p.status === "proposed" || p.status === "error");
  const done = proposals.filter((p) => p.status === "created" || p.status === "rejected");

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight text-white">
            AP Inbox
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Penny reads bills from the Zoho Books Documents inbox and proposes the
            entry. You approve each one before it&apos;s created.
          </p>
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="rounded-lg bg-[#00d6ff] px-5 py-2.5 text-sm font-semibold text-[#06232b] transition-colors hover:bg-[#00a6c9] disabled:opacity-40"
        >
          {scanning ? "Penny is reading…" : "Scan inbox"}
        </button>
      </header>

      {note && (
        <p className="rounded-lg border border-gray-800 bg-[#0d0d0d] px-4 py-2.5 text-sm text-gray-300">
          {note}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : open.length === 0 ? (
        <p className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">
          Nothing waiting. Hit <span className="text-gray-200">Scan inbox</span> to
          have Penny read the latest bills.
        </p>
      ) : (
        <div className="space-y-3">
          {open.map((p) => (
            <ProposalCard key={p.id} p={p} busy={busyId === p.id} onDecide={decide} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="space-y-2 pt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Handled
          </h2>
          {done.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-gray-800/50 bg-[#0d0d0d] px-4 py-2 text-xs text-gray-400"
            >
              <span className="truncate">
                {p.fileName} — {p.vendor || "?"} ${p.amount.toFixed(2)}
              </span>
              <span className={p.status === "created" ? "text-green-500" : "text-gray-600"}>
                {p.status === "created"
                  ? `✓ ${p.entryType}${p.zohoNumber ? ` ${p.zohoNumber}` : ""}`
                  : "dismissed"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  p,
  busy,
  onDecide,
}: {
  p: Proposal;
  busy: boolean;
  onDecide: (id: string, mode: "approve" | "reject", force?: boolean) => void;
}) {
  const errored = p.status === "error";
  const isDup = !!p.duplicateOf;
  return (
    <div className="rounded-xl border border-gray-800 bg-[#0d0d0d] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-gray-700 bg-gray-800/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-300">
              {p.entryType}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${confColor[p.confidence]}`}>
              {p.confidence}
            </span>
            {p.alreadyPaid && (
              <span className="rounded-full border border-[#00d6ff]/40 bg-[#00d6ff]/10 px-2 py-0.5 text-[10px] font-semibold text-[#00d6ff]">
                already paid{p.paidVia ? ` · ${p.paidVia}` : ""}
              </span>
            )}
          </div>
          <p className="mt-1.5 truncate text-sm font-semibold text-white">
            {p.vendor || "(vendor?)"} — ${p.amount.toFixed(2)} {p.currency}
          </p>
          <p className="text-xs text-gray-500">
            {p.date || "no date"}
            {p.reference ? ` · ref ${p.reference}` : ""} · {p.fileName}
          </p>
        </div>
        <a
          href={`/api/accounting/ap/doc?id=${p.documentId}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs text-[#00d6ff] hover:text-[#7be9ff]"
          title="Open the source document"
        >
          View PDF ↗
        </a>
      </div>

      <div className="mt-3 rounded-lg border border-gray-800/70 bg-[#111]/50 p-3 text-xs text-gray-300">
        <p>
          <span className="text-gray-500">Account:</span> {p.expenseAccount || "—"}
          {p.entryType === "expense" && (
            <>
              {"  ·  "}
              <span className="text-gray-500">Paid through:</span> {p.paidThroughAccount || "—"}
            </>
          )}
        </p>
        {p.rationale && <p className="mt-1 text-gray-400">{p.rationale}</p>}
        {errored && p.error && <p className="mt-1 text-red-400">⚠ {p.error}</p>}
      </div>

      {isDup && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-300">
          ⚠ Possible duplicate — already in Zoho as{" "}
          <span className="font-semibold">{p.duplicateOf}</span>. Only create if this
          is genuinely a separate bill.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onDecide(p.id, "approve", isDup)}
          disabled={busy}
          className={`rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-40 ${
            isDup ? "bg-amber-600 hover:bg-amber-500" : "bg-green-600 hover:bg-green-500"
          }`}
        >
          {busy
            ? "Creating…"
            : isDup
              ? "Create anyway"
              : errored
                ? "Retry create"
                : `Approve → create ${p.entryType}`}
        </button>
        <button
          onClick={() => onDecide(p.id, "reject")}
          disabled={busy}
          className="rounded-lg border border-gray-700 px-4 py-2 text-xs font-semibold text-gray-300 transition-colors hover:border-gray-500 disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
