"use client";

// ---------------------------------------------------------------------------
// ActivityFeed — reusable "what's happening" panel.
//
// Points at any activity endpoint (/api/agents/activity?agentId=… for one
// employee, /api/activity for the whole company). Auto-refreshes every 12s so
// dispatched work shows up on its own: active items (working / in review /
// needs you) up top, finished items below with an expandable report.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import ReportRenderer from "@/components/report-renderer";

interface Item {
  id: string;
  kind: "run" | "work" | "pending";
  agentId: string;
  agentName: string;
  title: string;
  status: string;
  at: string;
  body: string;
  active: boolean;
}

function statusMeta(status: string): { label: string; dot: string; spin?: boolean } {
  switch (status) {
    case "working":
    case "in_progress":
      return { label: "Working", dot: "bg-amber-400", spin: true };
    case "queued":
      return { label: "Queued", dot: "bg-gray-500" };
    case "in_review":
      return { label: "In review", dot: "bg-sky-400" };
    case "revision":
      return { label: "Revising", dot: "bg-amber-400", spin: true };
    case "approved":
      return { label: "Awaiting your approval", dot: "bg-[#00d6ff]" };
    case "escalated":
      return { label: "Needs your call", dot: "bg-red-400" };
    case "shipped":
    case "success":
      return { label: "Done", dot: "bg-emerald-400" };
    case "error":
      return { label: "Failed", dot: "bg-red-400" };
    case "rejected":
      return { label: "Rejected", dot: "bg-red-400" };
    default:
      return { label: status, dot: "bg-gray-500" };
  }
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

export default function ActivityFeed({
  endpoint,
  title,
  showAgent = false,
  emptyHint = "Nothing yet.",
}: {
  endpoint: string;
  title: string;
  showAgent?: boolean;
  emptyHint?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(endpoint);
      const d = await res.json().catch(() => ({}));
      if (Array.isArray(d.items)) setItems(d.items);
    } catch {
      /* keep the last good state */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [endpoint]);

  useEffect(() => {
    load();
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
  }, [load]);

  const active = items.filter((i) => i.active);
  const done = items.filter((i) => !i.active);

  const row = (i: Item, isActive: boolean) => {
    const meta = statusMeta(i.status);
    const open = expanded === i.id;
    const canExpand = !isActive && i.body.trim().length > 0;
    return (
      <div
        key={i.id}
        className={`rounded-lg border ${
          isActive ? "border-amber-800/40 bg-amber-950/10" : "border-gray-800 bg-[#0f0f0f]"
        }`}
      >
        <button
          onClick={() => canExpand && setExpanded(open ? null : i.id)}
          className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${canExpand ? "" : "cursor-default"}`}
        >
          {meta.spin ? (
            <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          ) : (
            <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} title={meta.label} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-gray-200">
              {showAgent && <span className="text-gray-400">{i.agentName}: </span>}
              {i.title}
            </p>
            <p className="text-[11px] text-gray-500">
              {meta.label} · {timeAgo(i.at)}
            </p>
          </div>
          {canExpand && <span className="text-xs text-gray-600">{open ? "▾" : "▸"}</span>}
        </button>
        {open && (
          <div className="border-t border-gray-800 px-3 py-3">
            {i.status === "error" ? (
              <p className="text-sm text-red-300">{i.body}</p>
            ) : (
              <ReportRenderer text={i.body} agentName={i.agentName} />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-[#0d0d0d]">
      <div className="flex items-center justify-between border-b border-gray-800 bg-[#111] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{title}</span>
          {active.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              {active.length} active
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

      <div className="max-h-[440px] overflow-y-auto p-3 space-y-2">
        {active.map((i) => row(i, true))}
        {active.length > 0 && done.length > 0 && (
          <div className="px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
            Recently done
          </div>
        )}
        {done.map((i) => row(i, false))}
        {!loading && items.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-gray-600">{emptyHint}</p>
        )}
        {loading && <p className="px-1 py-6 text-center text-sm text-gray-600">Loading…</p>}
      </div>
    </div>
  );
}
