"use client";

// ---------------------------------------------------------------------------
// WorkPipeline — one live board for every piece of work.
//
// What it replaces: work split across /work and /review, with different
// buttons, neither of which updated on its own. Watching something move from
// assigned to working to review meant refreshing and guessing.
//
// So: every order in one place, arranged left to right by stage, polling on
// its own, with the action that unblocks a card sitting ON that card. A card
// that changed since the last poll flashes, so movement is something you SEE
// rather than something you go looking for.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  STAGE_ORDER,
  STAGE_LABELS,
  STAGE_BLURBS,
  STATUS_PHRASING,
  stageOf,
  type Stage,
} from "@/lib/org/pipeline-stages";
import type { WorkOrderStatus } from "@/lib/org/types";

const POLL_MS = 5000;

interface Order {
  id: string;
  title: string;
  status: WorkOrderStatus;
  assigneeId: string;
  departmentId: string;
  updatedAt: string;
  createdAt: string;
}

interface Employee {
  id: string;
  name: string;
}

function ageLabel(iso: string): string {
  const h = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000));
  if (h < 1) {
    const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
    return m < 1 ? "just now" : `${m}m`;
  }
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function WorkPipeline() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ids whose stage changed on the most recent poll — these flash.
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const prevStage = useRef<Record<string, Stage>>({});

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [wRes, dRes] = await Promise.all([
        fetch("/api/org/work-orders?limit=200").then((r) => r.json()),
        Object.keys(prevStage.current).length === 0
          ? fetch("/api/org/directory").then((r) => r.json())
          : Promise.resolve(null),
      ]);
      const next: Order[] = wRes.orders ?? [];

      // Work out what moved BEFORE overwriting the previous snapshot.
      const justMoved = new Set<string>();
      for (const o of next) {
        const was = prevStage.current[o.id];
        const now = stageOf(o.status);
        if (was && was !== now) justMoved.add(o.id);
        prevStage.current[o.id] = now;
      }
      if (justMoved.size > 0) {
        setMoved(justMoved);
        setTimeout(() => setMoved(new Set()), 4000);
      }

      setOrders(next);
      if (dRes?.employees) {
        const map: Record<string, string> = {};
        for (const e of dRes.employees as Employee[]) map[e.id] = e.name;
        setPeople(map);
      }
      setLastSync(new Date());
      setError(null);
    } catch {
      setError("Couldn't reach HQ — retrying.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: string, action: "ship" | "send_back" | "reject" | "run") {
    if (action === "reject" && !confirm("Kill this piece of work?")) return;
    setBusyId(id);
    try {
      await fetch(`/api/org/work-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load(true);
    } catch {
      setError("That didn't go through.");
    } finally {
      setBusyId(null);
    }
  }

  const byStage = (s: Stage) =>
    orders
      .filter((o) => stageOf(o.status) === s)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      // "Done" is history — a long tail of it buries the live work.
      .slice(0, s === "done" ? 8 : 100);

  const waitingOnYou = byStage("you").length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-200">Work Pipeline</h2>
          <p className="mt-1 text-sm text-gray-500">
            Everything in flight, left to right. Updates on its own — no need to
            refresh.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {waitingOnYou > 0 && (
            <span className="rounded-full border border-amber-700/50 bg-amber-950/40 px-2.5 py-1 font-medium text-amber-300">
              {waitingOnYou} waiting on you
            </span>
          )}
          <span className="flex items-center gap-1.5 text-gray-600">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                error ? "bg-red-500" : "bg-green-500"
              }`}
            />
            {error
              ? error
              : lastSync
                ? `Live · checked ${ageLabel(lastSync.toISOString())} ago`
                : "Connecting…"}
          </span>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-600">Loading the board…</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-gray-600">
          Nothing in flight. Assign something from an agent&apos;s page and it
          will appear here.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          {STAGE_ORDER.map((stage) => {
            const items = byStage(stage);
            const isYours = stage === "you";
            return (
              <div key={stage} className="min-w-0">
                <div className="mb-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3
                      className={`text-xs font-semibold uppercase tracking-wider ${
                        isYours && items.length > 0 ? "text-amber-300" : "text-gray-500"
                      }`}
                    >
                      {STAGE_LABELS[stage]}
                    </h3>
                    <span className="text-xs text-gray-600">{items.length}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-tight text-gray-700">
                    {STAGE_BLURBS[stage]}
                  </p>
                </div>

                <div className="space-y-2">
                  {items.length === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-800/60 p-3 text-center text-[11px] text-gray-700">
                      Empty
                    </div>
                  )}
                  {items.map((o) => {
                    const flash = moved.has(o.id);
                    return (
                      <div
                        key={o.id}
                        className={`rounded-xl border p-3 transition-all duration-700 ${
                          flash
                            ? "border-[#00d6ff] bg-[#0094b8]/15"
                            : isYours
                              ? "border-amber-800/50 bg-amber-950/20"
                              : "border-gray-800/80 bg-[#101010]/80"
                        }`}
                      >
                        <p className="text-sm font-medium leading-snug text-gray-200">
                          {o.title}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-500">
                          {people[o.assigneeId] ?? o.assigneeId} · {ageLabel(o.updatedAt)}
                        </p>
                        <p
                          className={`mt-1 text-[11px] ${
                            o.status === "error" ? "text-red-400" : "text-gray-600"
                          }`}
                        >
                          {STATUS_PHRASING[o.status]}
                        </p>

                        {/* The action that unblocks it, on the card itself. */}
                        {o.status === "approved" && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              onClick={() => void act(o.id, "ship")}
                              disabled={busyId === o.id}
                              className="rounded-lg bg-[#00d6ff] px-2.5 py-1 text-[11px] font-semibold text-black hover:bg-[#00d6ff]/90 disabled:opacity-50"
                            >
                              {busyId === o.id ? "…" : "Approve & ship"}
                            </button>
                            <button
                              onClick={() => void act(o.id, "send_back")}
                              disabled={busyId === o.id}
                              className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 hover:bg-white/[0.05] disabled:opacity-50"
                            >
                              Send back
                            </button>
                          </div>
                        )}
                        {(o.status === "error" || o.status === "revision") && (
                          <button
                            onClick={() => void act(o.id, "run")}
                            disabled={busyId === o.id}
                            className="mt-2 rounded-lg border border-[#0094b8]/40 bg-[#0094b8]/10 px-2.5 py-1 text-[11px] font-medium text-[#00d6ff] hover:bg-[#0094b8]/20 disabled:opacity-50"
                          >
                            {busyId === o.id ? "…" : "Run it again"}
                          </button>
                        )}
                        {o.status === "escalated" && (
                          <Link
                            href="/review"
                            className="mt-2 inline-block rounded-lg border border-amber-700/50 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-950/40"
                          >
                            Answer the question
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
