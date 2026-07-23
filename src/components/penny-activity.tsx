"use client";

// ---------------------------------------------------------------------------
// PennyActivity — live view of what Penny is doing and everything she's done.
//
// Auto-refreshes every 12s (and on a manual Refresh) so work Sterling dispatches
// shows up without a reload: an in-flight "Working on…" row while it runs, then
// the finished result with status + an expandable report.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import ReportRenderer from "@/components/report-renderer";

interface RunLog {
  id: string;
  agentName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "error";
  output: string;
}
interface Pending {
  id: string;
  task: string;
  startedAt: string;
}

// Friendly names for the task keys Sterling dispatches.
const TASK_LABELS: Record<string, string> = {
  "auto-categorize": "Categorizing transactions",
  "books-health": "Running the books-health report",
  reconcile: "Reconciling accounts",
};
function taskLabel(task: string): string {
  return TASK_LABELS[task] ?? task.replace(/[-_]/g, " ");
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function PennyActivity() {
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/accounting/activity");
      const d = await res.json().catch(() => ({}));
      if (Array.isArray(d.runs)) setRuns(d.runs);
      if (Array.isArray(d.pending)) setPending(d.pending);
    } catch {
      /* leave the last good state */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="mt-6 rounded-xl border border-gray-800 bg-[#0d0d0d]">
      <div className="flex items-center justify-between border-b border-gray-800 bg-[#111] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">Penny&apos;s Activity</span>
          {pending.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              {pending.length} working
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 px-2.5 py-1 text-[11px] text-gray-400 transition-colors hover:border-[#00d6ff]/40 hover:text-gray-200 disabled:opacity-50"
        >
          <span className={refreshing ? "inline-block animate-spin" : ""}>↻</span> Refresh
        </button>
      </div>

      <div className="max-h-[420px] overflow-y-auto p-3 space-y-2">
        {/* In-flight work */}
        {pending.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2.5"
          >
            <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
            <div className="min-w-0">
              <p className="text-sm text-amber-200">{taskLabel(p.task)}…</p>
              <p className="text-[11px] text-amber-500/70">started {timeAgo(p.startedAt)}</p>
            </div>
          </div>
        ))}

        {/* Finished runs */}
        {runs.map((r) => {
          const open = expanded === r.id;
          return (
            <div key={r.id} className="rounded-lg border border-gray-800 bg-[#0f0f0f]">
              <button
                onClick={() => setExpanded(open ? null : r.id)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    r.status === "success" ? "bg-emerald-400" : "bg-red-400"
                  }`}
                  title={r.status}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-200">{r.agentName}</p>
                  <p className="text-[11px] text-gray-500">
                    {timeAgo(r.finishedAt || r.startedAt)}
                    {r.durationMs ? ` · took ${duration(r.durationMs)}` : ""}
                    {r.status === "error" ? " · failed" : ""}
                  </p>
                </div>
                <span className="text-xs text-gray-600">{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="border-t border-gray-800 px-3 py-3">
                  {r.status === "error" ? (
                    <p className="text-sm text-red-300">{r.output}</p>
                  ) : (
                    <ReportRenderer text={r.output} agentName="Penny" />
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!loading && pending.length === 0 && runs.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-gray-600">
            Nothing yet. When Sterling puts Penny on something, it&apos;ll show up here — live.
          </p>
        )}
        {loading && <p className="px-1 py-6 text-center text-sm text-gray-600">Loading…</p>}
      </div>
    </div>
  );
}
