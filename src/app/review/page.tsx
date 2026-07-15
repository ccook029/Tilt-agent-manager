"use client";

// ---------------------------------------------------------------------------
// /review — the owner's approval console (Chris keeps the ship trigger).
//
// One place to work the whole company's output:
//  - READY TO SHIP: boss-approved work orders. Approve (ship), send back with
//    notes (re-runs a revision round), or reject.
//  - NEEDS YOUR DECISION: escalations across every department. Answering one
//    resolves it AND records the answer as standing department policy.
//
// Everything is grounded by /api/org/* — no publishing happens here; approving
// a marketing piece stages it for the (Phase 3) publisher, it does not post.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface WorkRound {
  round: number;
  draft: string;
}
interface ManagerReview {
  round: number;
  verdict: string;
  notes: string;
}
interface WorkOrder {
  id: string;
  departmentId: string;
  assigneeId: string;
  title: string;
  brief: string;
  deliverableType: string;
  status: string;
  createdBy: string;
  createdAt: string;
  rounds: WorkRound[];
  reviews: ManagerReview[];
}
interface Escalation {
  id: string;
  question: string;
  reason: string;
  recommendation?: string;
  departmentId: string;
  departmentName?: string;
  raisedAt: string;
}
interface Employee {
  id: string;
  name: string;
  title: string;
}
interface Department {
  id: string;
  name: string;
}

export default function ReviewPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [employees, setEmployees] = useState<Record<string, Employee>>({});
  const [departments, setDepartments] = useState<Record<string, Department>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [q, esc, dir] = await Promise.all([
      fetch("/api/org/work-orders?queue=owner").then((r) => r.json()).catch(() => ({})),
      fetch("/api/org/escalations").then((r) => r.json()).catch(() => ({})),
      fetch("/api/org/directory").then((r) => r.json()).catch(() => ({})),
    ]);
    setOrders(q.orders ?? []);
    setEscalations(esc.escalations ?? []);
    const emp: Record<string, Employee> = {};
    for (const e of dir.employees ?? []) emp[e.id] = e;
    setEmployees(emp);
    const dep: Record<string, Department> = {};
    for (const d of dir.departments ?? []) dep[d.id] = d;
    setDepartments(dep);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (
    id: string,
    action: "ship" | "send_back" | "reject",
    notes?: string
  ) => {
    setBusy(id);
    try {
      await fetch(`/api/org/work-orders/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const answer = async (esc: Escalation, decision: string) => {
    if (!decision.trim()) return;
    setBusy(esc.id);
    try {
      await fetch("/api/org/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: esc.departmentId,
          escalationId: esc.id,
          answer: decision,
        }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const approved = orders.filter((o) => o.status === "approved");
  const escalatedOrders = orders.filter((o) => o.status === "escalated");

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
            Review
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Everything your departments have approved and are waiting on you to
            ship. Nothing publishes until you approve it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DispatchWeekButton onDone={load} />
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700"
          >
            ← Dashboard
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
              Ready to ship — {approved.length}
            </h2>
            {approved.length === 0 ? (
              <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">
                Nothing waiting. As your teams finish work and their bosses
                approve it, it lands here for your final sign-off.
              </div>
            ) : (
              approved.map((o) => (
                <WorkOrderCard
                  key={o.id}
                  order={o}
                  employees={employees}
                  departments={departments}
                  busy={busy === o.id}
                  onShip={(n) => act(o.id, "ship", n)}
                  onSendBack={(n) => act(o.id, "send_back", n)}
                  onReject={(n) => act(o.id, "reject", n)}
                />
              ))
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Needs your decision — {escalations.length}
            </h2>
            {escalations.length === 0 ? (
              <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">
                No open questions across any department.
              </div>
            ) : (
              escalations.map((e) => (
                <EscalationCard
                  key={e.id}
                  esc={e}
                  busy={busy === e.id}
                  onAnswer={(d) => answer(e, d)}
                />
              ))
            )}
          </section>

          {escalatedOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Escalated work orders — {escalatedOrders.length}
              </h2>
              <p className="text-xs text-gray-600">
                These are blocked on a question above. Answer the question, then
                send the work order back so the team can finish it.
              </p>
              {escalatedOrders.map((o) => (
                <WorkOrderCard
                  key={o.id}
                  order={o}
                  employees={employees}
                  departments={departments}
                  busy={busy === o.id}
                  onSendBack={(n) => act(o.id, "send_back", n)}
                  onReject={(n) => act(o.id, "reject", n)}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** On-demand trigger for Harper's weekly dispatch (Chris chose on-demand over
 * the Monday cron until the cadence feels normal). Takes a few minutes: Harper
 * plans, the team drafts, she reviews, and results land in the queue above. */
function DispatchWeekButton({ onDone }: { onDone: () => Promise<void> }) {
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setNote(null);
    try {
      const res = await fetch("/api/marketing/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => ({}));
      setNote(
        res.ok
          ? `Harper dispatched ${d.dispatched ?? 0} pieces — ${d.approved ?? 0} ready for you${d.escalated ? `, ${d.escalated} escalated` : ""}.`
          : d.error ?? "Dispatch failed."
      );
      await onDone();
    } catch {
      setNote("Dispatch failed — try again.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {note && <span className="text-[11px] text-gray-500">{note}</span>}
      <button
        onClick={run}
        disabled={running}
        className="rounded-lg bg-[#0094b8] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#00a8d1] disabled:opacity-50"
      >
        {running ? "Harper's team is working…" : "Run marketing week"}
      </button>
    </div>
  );
}

function WorkOrderCard({
  order,
  employees,
  departments,
  busy,
  onShip,
  onSendBack,
  onReject,
}: {
  order: WorkOrder;
  employees: Record<string, Employee>;
  departments: Record<string, Department>;
  busy: boolean;
  onShip?: (notes?: string) => void;
  onSendBack?: (notes: string) => void;
  onReject?: (notes?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  const draft = order.rounds[order.rounds.length - 1]?.draft ?? "(no draft)";
  const review = order.reviews[order.reviews.length - 1]?.notes;
  const who = employees[order.assigneeId];
  const dept = departments[order.departmentId];

  return (
    <div className="space-y-3 rounded-xl border border-emerald-900/40 bg-emerald-950/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-100">{order.title}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {dept?.name ?? order.departmentId} · {who?.name ?? order.assigneeId} ·{" "}
            {order.deliverableType}
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-xs text-gray-500 hover:text-gray-300"
        >
          {expanded ? "hide" : "view"}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 rounded-lg border border-gray-800/60 bg-black/30 p-3">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Brief
            </p>
            <p className="whitespace-pre-wrap text-xs text-gray-400">{order.brief}</p>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Deliverable
            </p>
            <p className="whitespace-pre-wrap text-xs text-gray-300">{draft}</p>
          </div>
          {review && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#00d6ff]">
                Boss review
              </p>
              <p className="whitespace-pre-wrap text-xs text-gray-400">{review}</p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional note / what to change…"
          className="min-w-[12rem] flex-1 rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-xs text-gray-200 focus:border-emerald-500 focus:outline-none"
          disabled={busy}
        />
        {onShip && (
          <button
            onClick={() => onShip(notes.trim() || undefined)}
            disabled={busy}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
          >
            {busy ? "…" : "Approve & ship"}
          </button>
        )}
        {onSendBack && (
          <button
            onClick={() => notes.trim() && onSendBack(notes.trim())}
            disabled={busy || !notes.trim()}
            title={!notes.trim() ? "Add a note so the team knows what to change" : ""}
            className="rounded-md border border-amber-700/60 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-600/20 disabled:opacity-40"
          >
            Send back
          </button>
        )}
        {onReject && (
          <button
            onClick={() => onReject(notes.trim() || undefined)}
            disabled={busy}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-red-700 hover:text-red-300 disabled:opacity-40"
          >
            Reject
          </button>
        )}
      </div>
    </div>
  );
}

function EscalationCard({
  esc,
  busy,
  onAnswer,
}: {
  esc: Escalation;
  busy: boolean;
  onAnswer: (decision: string) => void;
}) {
  const [val, setVal] = useState(esc.recommendation ?? "");
  return (
    <div className="space-y-3 rounded-xl border border-amber-800/40 bg-amber-950/10 p-4">
      <p className="text-sm text-gray-200">{esc.question}</p>
      <p className="text-xs text-gray-500">
        {esc.departmentName ?? esc.departmentId} · {esc.reason} · raised{" "}
        {esc.raisedAt.slice(0, 10)}
      </p>
      {esc.recommendation && (
        <p className="text-xs text-gray-400">
          Recommendation: {esc.recommendation}
        </p>
      )}
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAnswer(val)}
          placeholder="Your decision…"
          className="flex-1 rounded-md border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm text-gray-200 focus:border-amber-500 focus:outline-none"
          disabled={busy}
        />
        <button
          onClick={() => onAnswer(val)}
          disabled={busy || !val.trim()}
          className="rounded-md bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-500 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Decide"}
        </button>
      </div>
    </div>
  );
}
