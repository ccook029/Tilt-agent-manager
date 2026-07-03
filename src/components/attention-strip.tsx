"use client";

// ---------------------------------------------------------------------------
// AttentionStrip — the dashboard's "what needs me" line: open decisions
// (→ /questions) and the cleanup backlog burning down.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import Link from "next/link";

interface ProgressPoint {
  at: string;
  uncategorized: number;
  written: number;
}

export default function AttentionStrip() {
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [assignedCount, setAssignedCount] = useState<number>(0);
  const [latest, setLatest] = useState<ProgressPoint | null>(null);
  const [previous, setPrevious] = useState<ProgressPoint | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/accounting-manager/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "list" }),
        });
        // 403 for non-owners → data.open is undefined → count stays 0.
        const data = await res.json();
        setOpenCount((data.open ?? []).length);
      } catch {
        /* ignore */
      }
      try {
        // Questions delegated to whoever is signed in (owner or not).
        const res = await fetch("/api/my-questions");
        const data = await res.json();
        setAssignedCount((data.questions ?? []).length);
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch("/api/accounting/progress");
        const data = await res.json();
        const pts: ProgressPoint[] = data.points ?? [];
        setLatest(pts[pts.length - 1] ?? null);
        setPrevious(pts[pts.length - 2] ?? null);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const showQuestions = (openCount ?? 0) > 0;
  const showAssigned = assignedCount > 0;
  const showProgress = latest !== null;
  if (!showQuestions && !showAssigned && !showProgress) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showQuestions && (
        <Link
          href="/questions"
          className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-4 py-2.5 text-sm text-amber-200 transition-colors hover:bg-amber-500/[0.15]"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold">
            {openCount}
          </span>
          decision{(openCount ?? 0) > 1 ? "s" : ""} waiting on you — answer here
          <span aria-hidden>→</span>
        </Link>
      )}
      {showAssigned && (
        <Link
          href="/questions"
          className="flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/[0.08] px-4 py-2.5 text-sm text-cyan-200 transition-colors hover:bg-cyan-500/[0.15]"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/20 text-xs font-bold">
            {assignedCount}
          </span>
          question{assignedCount > 1 ? "s" : ""} assigned to you — answer here
          <span aria-hidden>→</span>
        </Link>
      )}
      {showProgress && latest && (
        <span className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.06] px-4 py-2.5 text-sm text-cyan-200">
          Books backlog: <strong>{latest.uncategorized}</strong> uncategorized
          {previous && previous.uncategorized > latest.uncategorized && (
            <span className="text-xs text-emerald-300">
              ▼ {previous.uncategorized - latest.uncategorized} last batch
            </span>
          )}
        </span>
      )}
    </div>
  );
}
