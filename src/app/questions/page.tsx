"use client";

// ---------------------------------------------------------------------------
// /questions — role-aware decisions console.
//
//  - Accounting owner (Chris): every open question, with the ability to answer
//    or delegate each one to another staff member, plus the Excel round-trip
//    and the decided-history. This is the accounting surface, owner-only.
//  - Everyone else: ONLY the questions delegated to them (via /api/my-questions),
//    which they can answer. They never see the rest of the queue.
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
  answeredBy?: string;
  assigneeEmail?: string;
  assigneeName?: string;
}

interface StaffProfile {
  id: number;
  name: string;
  email: string;
}

export default function QuestionsPage() {
  const [me, setMe] = useState<{ isOwner: boolean; ready: boolean }>({
    isOwner: false,
    ready: false,
  });

  useEffect(() => {
    fetch("/api/os/me")
      .then((r) => r.json())
      .then((d) => setMe({ isOwner: Boolean(d.isAccountingOwner), ready: true }))
      .catch(() => setMe({ isOwner: false, ready: true }));
  }, []);

  if (!me.ready) {
    return <p className="mx-auto max-w-3xl px-4 py-8 text-gray-500">Loading…</p>;
  }
  return me.isOwner ? <OwnerConsole /> : <AssigneeView />;
}

// ---- Owner console --------------------------------------------------------

function OwnerConsole() {
  const [open, setOpen] = useState<Escalation[]>([]);
  const [resolved, setResolved] = useState<Escalation[]>([]);
  const [policyCount, setPolicyCount] = useState(0);
  const [directory, setDirectory] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState<string | null>(null);

  const post = (payload: object) =>
    fetch("/api/accounting-manager/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  const load = useCallback(async () => {
    try {
      const [listRes, dirRes] = await Promise.all([
        post({ mode: "list-all" }),
        post({ mode: "directory" }),
      ]);
      const data = await listRes.json();
      const dir = await dirRes.json().catch(() => ({ staff: [] }));
      setOpen(data.open ?? []);
      setResolved(data.resolved ?? []);
      setPolicyCount(data.policyCount ?? 0);
      setDirectory(dir.staff ?? []);
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
      await post({ mode: "answer", escalationId: esc.id, answer: decision });
      await load();
    } finally {
      setAnswering(null);
    }
  };

  const assign = async (esc: Escalation, email: string, name: string) => {
    await post({
      mode: "assign",
      escalationId: esc.id,
      assigneeEmail: email,
      assigneeName: name,
    });
    await load();
  };

  const unassign = async (esc: Escalation) => {
    await post({ mode: "assign", escalationId: esc.id, unassign: true });
    await load();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
            Decisions Needed
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Every question your agents are waiting on. Answer it yourself, or
            hand it to a teammate. Each answer becomes standing policy
            ({policyCount} learned so far).
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
                Nothing needs you right now. 🎉 New questions land here (and in the
                Morning Brief) as the agents work.
              </div>
            ) : (
              open.map((e) => (
                <QuestionCard key={e.id} esc={e} onAnswer={answer} busy={answering === e.id}>
                  <AssignRow
                    esc={e}
                    directory={directory}
                    onAssign={assign}
                    onUnassign={unassign}
                  />
                </QuestionCard>
              ))
            )}
          </section>

          {resolved.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Decided — {resolved.length} most recent
              </h2>
              {resolved.map((e) => (
                <div key={e.id} className="rounded-xl border border-gray-800/60 bg-[#0d0d0d] p-4">
                  <p className="text-sm text-gray-400">{e.question}</p>
                  <p className="mt-2 text-sm text-emerald-300">
                    ✓ {e.answer}
                    <span className="ml-2 text-[11px] text-gray-600">
                      {e.answeredBy ? `${e.answeredBy} · ` : ""}
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

function AssignRow({
  esc,
  directory,
  onAssign,
  onUnassign,
}: {
  esc: Escalation;
  directory: StaffProfile[];
  onAssign: (e: Escalation, email: string, name: string) => void;
  onUnassign: (e: Escalation) => void;
}) {
  const [email, setEmail] = useState("");

  if (esc.assigneeEmail) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="rounded-full border border-cyan-900/60 px-2 py-0.5 text-[#00d6ff]">
          Assigned to {esc.assigneeName ?? esc.assigneeEmail}
        </span>
        <button
          onClick={() => onUnassign(esc)}
          className="text-gray-600 hover:text-gray-300"
        >
          unassign
        </button>
      </div>
    );
  }

  const pick = (val: string) => {
    const match = directory.find((s) => s.email === val);
    onAssign(esc, val, match?.name ?? val);
    setEmail("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-gray-600">Delegate:</span>
      <input
        list={`staff-${esc.id}`}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="name@tilthockey.com"
        className="min-w-[12rem] flex-1 rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1 text-gray-200 focus:border-[#00d6ff] focus:outline-none"
      />
      <datalist id={`staff-${esc.id}`}>
        {directory.map((s) => (
          <option key={s.id} value={s.email}>
            {s.name}
          </option>
        ))}
      </datalist>
      <button
        onClick={() => email.trim() && pick(email.trim())}
        disabled={!email.trim()}
        className="rounded-md border border-gray-700 px-3 py-1 text-gray-300 hover:border-[#00d6ff] disabled:opacity-40"
      >
        Assign
      </button>
    </div>
  );
}

// ---- Assignee (non-owner) view --------------------------------------------

function AssigneeView() {
  const [questions, setQuestions] = useState<Escalation[]>([]);
  const [needsEmail, setNeedsEmail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/my-questions");
      const data = await res.json().catch(() => ({}));
      setQuestions(data.questions ?? []);
      setNeedsEmail(Boolean(data.needsEmail));
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
      await fetch("/api/my-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalationId: esc.id, answer: decision }),
      });
      await load();
    } finally {
      setAnswering(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
          Your Questions
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Questions assigned to you to answer. Your answer is recorded as the
          decision.
        </p>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : needsEmail ? (
        <div className="rounded-xl border border-amber-800/40 bg-amber-950/10 p-6 text-sm text-gray-300">
          We couldn&apos;t match your account to an email. Sign out and sign back
          in with your email address so assigned questions can reach you.
        </div>
      ) : questions.length === 0 ? (
        <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">
          Nothing is assigned to you right now.
        </div>
      ) : (
        <section className="space-y-3">
          {questions.map((e) => (
            <QuestionCard key={e.id} esc={e} onAnswer={answer} busy={answering === e.id} />
          ))}
        </section>
      )}
    </div>
  );
}

// ---- Shared answer card ---------------------------------------------------

function QuestionCard({
  esc,
  onAnswer,
  busy,
  children,
}: {
  esc: Escalation;
  onAnswer: (e: Escalation, decision: string) => void;
  busy: boolean;
  children?: React.ReactNode;
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
      {children}
    </div>
  );
}
