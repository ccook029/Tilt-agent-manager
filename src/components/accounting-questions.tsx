"use client";

// ---------------------------------------------------------------------------
// AccountingQuestions — Penny's desk: the questions she's waiting on, answerable
// in place.
//
// The point: her run report and her questions used to live in different places,
// so answering meant re-reading the report, remembering it, and retyping the
// context into a chat. Here each question carries its own money — amount, date,
// payer — and the answer BUTTON does the work (posts the held line, applies the
// payment, matches the recorded one) rather than just recording a note.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

interface ProposedAction {
  type: "post" | "apply_to_invoice" | "match";
  account?: string;
  direction?: "in" | "out";
  tax?: string;
  invoiceNumber?: string;
}
interface EscalationContext {
  transactionId?: string;
  amount?: number;
  date?: string;
  payee?: string;
  proposedAction?: ProposedAction;
  affirmativeLabel?: string;
}
interface Question {
  id: string;
  question: string;
  reason: string;
  recommendation?: string;
  dollarAmount?: number;
  raisedAt: string;
  context?: EscalationContext;
}

export default function AccountingQuestions({
  title = "Penny's questions",
  emptyHint = "Nothing waiting on you — every transaction she's processed was either posted or reconciled.",
}: {
  title?: string;
  emptyHint?: string;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sweepNote, setSweepNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/accounting/questions").then((r) => r.json());
      setQuestions(d.open ?? []);
    } catch {
      /* leave the list as-is */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sweep = async () => {
    setBusy("sweep");
    setSweepNote(null);
    try {
      const res = await fetch("/api/accounting/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sweep" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSweepNote(
          d.error ??
            `The check failed (HTTP ${res.status}) — nothing was closed. Try again; if it keeps failing, that's a bug worth flagging.`
        );
        return;
      }
      setQuestions(d.open ?? []);
      // Report partial progress honestly: some batches can close while others fail.
      const parts: string[] = [];
      parts.push(
        d.closed > 0
          ? `Closed ${d.closed} question${d.closed === 1 ? "" : "s"} already covered by your standing policies — ${d.remaining} still need you.`
          : "Nothing to close — every open question still needs a real decision from you."
      );
      if (Array.isArray(d.errors) && d.errors.length > 0) {
        parts.push(`⚠️ ${d.errors.join(" · ")}`);
      }
      setSweepNote(parts.join(" "));
    } catch {
      setSweepNote("Network error — nothing was closed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (q: Question) => {
    setBusy(q.id);
    try {
      await fetch("/api/accounting/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalationId: q.id, action: "dismiss" }),
      });
      setQuestions((qs) => qs.filter((x) => x.id !== q.id));
    } catch {
      setErrors((e) => ({ ...e, [q.id]: "Couldn't dismiss that." }));
    } finally {
      setBusy(null);
    }
  };

  const submit = async (q: Question, approve: boolean) => {
    const answer = drafts[q.id]?.trim();
    if (!approve && !answer) return;
    setBusy(q.id);
    setErrors((e) => ({ ...e, [q.id]: "" }));
    try {
      const res = await fetch("/api/accounting/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalationId: q.id, approve, answer }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors((e) => ({ ...e, [q.id]: d.error ?? "Couldn't record that." }));
        return;
      }
      setDone((s) => ({
        ...s,
        [q.id]: d.actionSummary ?? "Recorded — that's standing policy now.",
      }));
      setQuestions((qs) => qs.filter((x) => x.id !== q.id));
    } catch {
      setErrors((e) => ({ ...e, [q.id]: "Network error — try again." }));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;

  const doneList = Object.entries(done);

  return (
    <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold uppercase tracking-wide text-gray-100">
            {title}
            {questions.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-900/40 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                {questions.length}
              </span>
            )}
          </h2>
          <p className="text-[11px] text-gray-500">
            Answer here and she acts on it — no need to re-run anything.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {questions.length > 0 && (
            <button
              onClick={sweep}
              disabled={busy === "sweep"}
              title="Penny re-reads every open question against your standing policies and closes the ones you've already answered."
              className="rounded-md border border-gray-700 px-2.5 py-1 text-[11px] font-medium text-gray-300 transition-colors hover:border-gray-500 disabled:opacity-50"
            >
              {busy === "sweep" ? "Checking…" : "Clear answered"}
            </button>
          )}
          <button
            onClick={load}
            className="text-[11px] text-gray-500 transition-colors hover:text-gray-300"
          >
            refresh
          </button>
        </div>
      </div>

      {sweepNote && (
        <p
          className={`mb-2 text-xs ${
            /fail|error|⚠️/i.test(sweepNote) ? "text-amber-400/90" : "text-emerald-400/90"
          }`}
        >
          {sweepNote}
        </p>
      )}

      {doneList.length > 0 && (
        <ul className="mb-3 space-y-1">
          {doneList.map(([id, msg]) => (
            <li key={id} className="text-xs text-emerald-400/90">
              ✓ {msg}
            </li>
          ))}
        </ul>
      )}

      {questions.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyHint}</p>
      ) : (
        <ul className="space-y-3">
          {questions.map((q) => {
            const ctx = q.context;
            const amount = ctx?.amount ?? q.dollarAmount;
            const canAct = Boolean(ctx?.proposedAction);
            const isOpen = expanded[q.id] === true;
            return (
              <li
                key={q.id}
                className="rounded-lg border border-gray-800 bg-[#0d0d0d]/60 p-3"
              >
                {/* The money, up front — this is what you're deciding about. */}
                {(amount != null || ctx?.date || ctx?.payee) && (
                  <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-sm">
                    {amount != null && (
                      <span className="font-semibold text-gray-100">
                        ${amount.toFixed(2)}
                      </span>
                    )}
                    {ctx?.payee && <span className="text-gray-300">{ctx.payee}</span>}
                    {ctx?.date && (
                      <span className="text-[11px] text-gray-500">{ctx.date}</span>
                    )}
                  </p>
                )}

                <p className="text-sm leading-snug text-gray-200">{q.question}</p>
                {q.recommendation && (
                  <p className="mt-1 text-xs text-gray-500">
                    <span className="text-gray-600">Her rec:</span> {q.recommendation}
                  </p>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {canAct && (
                    <button
                      onClick={() => submit(q, true)}
                      disabled={busy === q.id}
                      className="rounded-md bg-emerald-700/80 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busy === q.id
                        ? "Working…"
                        : (ctx?.affirmativeLabel ?? "Yes — go ahead")}
                    </button>
                  )}
                  <button
                    onClick={() => setExpanded((s) => ({ ...s, [q.id]: !isOpen }))}
                    className="text-[11px] text-gray-500 transition-colors hover:text-gray-300"
                  >
                    {isOpen ? "cancel" : canAct ? "No — something else ▾" : "Answer ▾"}
                  </button>
                  <button
                    onClick={() => dismiss(q)}
                    disabled={busy === q.id}
                    title="Close this without recording a rule (noise, duplicate, or handled elsewhere)"
                    className="ml-auto text-[11px] text-gray-600 transition-colors hover:text-gray-400 disabled:opacity-50"
                  >
                    dismiss
                  </button>
                </div>

                {isOpen && (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={drafts[q.id] ?? ""}
                      onChange={(e) =>
                        setDrafts((s) => ({ ...s, [q.id]: e.target.value }))
                      }
                      rows={2}
                      placeholder="Tell her what it actually is — she'll record it as standing policy and stop asking."
                      className="w-full rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-xs text-gray-200 focus:border-[#00d6ff] focus:outline-none"
                      disabled={busy === q.id}
                    />
                    <button
                      onClick={() => submit(q, false)}
                      disabled={busy === q.id || !(drafts[q.id] ?? "").trim()}
                      className="rounded-md bg-[#0094b8] px-3.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#00a8d1] disabled:opacity-40"
                    >
                      {busy === q.id ? "Recording…" : "Record answer"}
                    </button>
                  </div>
                )}

                {errors[q.id] && (
                  <p className="mt-1.5 text-[11px] text-red-400">{errors[q.id]}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
