"use client";

// ---------------------------------------------------------------------------
// /questions — the single place every decision the agents need from Chris
// lives: open questions with inline answers, the Excel round-trip, and the
// history of what's been decided (and became standing policy).
// ---------------------------------------------------------------------------
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Escalation {
  id: string;
  question: string;
  reason: string;
  recommendation?: string;
  dollarAmount?: number;
  status: "open" | "resolved";
  raisedAt: string;
  resolvedAt?: string;
  answer?: string;
}

export default function QuestionsPage() {
  const [open, setOpen] = useState<Escalation[]>([]);
  const [resolved, setResolved] = useState<Escalation[]>([]);
  const [policyCount, setPolicyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting-manager/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "list-all" }),
      });
      const data = await res.json();
      setOpen(data.open ?? []);
      setResolved(data.resolved ?? []);
      setPolicyCount(data.policyCount ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const answer = async (esc: Escalation, decision: string) => {
    if (!decision.trim()) return;
    setAnswering(esc.id);
    try {
      await fetch("/api/accounting-manager/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "answer", escalationId: esc.id, answer: decision }),
      });
      await load();
    } finally {
      setAnswering(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
            Decisions Needed
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Every question your agents are waiting on. Each answer becomes standing policy
            ({policyCount} learned so far) — you&apos;re never asked twice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/accounting/questions"
            download
            className="rounded-lg border border-amber-700/50 bg-amber-600/20 px-3 py-2 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-600/30"
          >
            ⬇ Answer by Excel
          </a>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700"
          >
            ← Dashboard
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Open — {open.length}
            </h2>
            {open.length === 0 ? (
              <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">
                Nothing needs you right now. 🎉 New questions land here (and in the Morning
                Brief) as the agents work.
              </div>
            ) : (
              open.map((e) => (
                <QuestionCard key={e.id} esc={e} onAnswer={answer} busy={answering === e.id} />
              ))
            )}
          </section>

          {resolved.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Decided — {resolved.length} most recent
              </h2>
              {resolved.map((e) => (
                <div
                  key={e.id}
                  className="rounded-xl border border-gray-800/60 bg-[#0d0d0d] p-4"
                >
                  <p className="text-sm text-gray-400">{e.question}</p>
                  <p className="mt-2 text-sm text-emerald-300">
                    ✓ {e.answer}
                    <span className="ml-2 text-[11px] text-gray-600">
                      {e.resolvedAt?.slice(0, 10)}
                    </span>
                  </p>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function QuestionCard({
  esc,
  onAnswer,
  busy,
}: {
  esc: Escalation;
  onAnswer: (e: Escalation, decision: string) => void;
  busy: boolean;
}) {
  const [val, setVal] = useState(esc.recommendation ?? "");
  return (
    <div className="space-y-3 rounded-xl border border-amber-800/40 bg-amber-950/10 p-4">
      <p className="text-sm text-gray-200">{esc.question}</p>
      <p className="text-xs text-gray-500">
        {esc.reason}
        {esc.dollarAmount ? ` · $${esc.dollarAmount}` : ""} · raised {esc.raisedAt.slice(0, 10)}
      </p>
      {esc.recommendation && (
        <p className="text-xs text-gray-400">Recommendation: {esc.recommendation}</p>
      )}
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAnswer(esc, val)}
          placeholder="Your decision..."
          className="flex-1 rounded-md border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm text-gray-200 focus:border-amber-500 focus:outline-none"
          disabled={busy}
        />
        <button
          onClick={() => onAnswer(esc, val)}
          disabled={busy || !val.trim()}
          className="rounded-md bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-500 disabled:opacity-40"
        >
          {busy ? "Saving..." : "Decide"}
        </button>
      </div>
    </div>
  );
}
