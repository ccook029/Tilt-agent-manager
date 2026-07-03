"use client";

// ---------------------------------------------------------------------------
// ProgressMetrics — the dashboard strip that actually moves (audit #17): the
// books cleanup burning down as a sparkline, plus the tallies that grow
// (policies learned, changes written, open decisions). Owner-only; renders
// nothing until there's cleanup history to show.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Sparkline } from "@/components/charts";

interface Metrics {
  backlog: {
    points: { at: string; uncategorized: number }[];
    current: number | null;
    start: number | null;
    cleared: number;
  };
  policiesLearned: number;
  changesWritten: number;
  openDecisions: number;
}

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-800/70 bg-[#0d0d0d] px-4 py-3">
      <div className={`text-2xl font-semibold ${accent ?? "text-gray-100"}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-gray-600">{label}</div>
    </div>
  );
}

export default function ProgressMetrics() {
  const [m, setM] = useState<Metrics | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = await fetch("/api/os/me").then((r) => r.json());
        if (me.authEnabled && !me.isAccountingOwner) return; // owner-only strip
        const res = await fetch("/api/accounting/metrics");
        if (!res.ok) return;
        const data = await res.json();
        setM(data);
        setShow(true);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  if (!show || !m) return null;
  const values = m.backlog.points.map((p) => p.uncategorized);
  const hasTrend = values.length >= 2;

  return (
    <section className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-gray-600">
        Books cleanup — progress
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 rounded-xl border border-gray-800/70 bg-[#0d0d0d] px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-wider text-gray-600">
              Uncategorized backlog
            </span>
            {m.backlog.cleared > 0 && (
              <span className="text-xs text-emerald-300">
                ▼ {m.backlog.cleared} cleared
              </span>
            )}
          </div>
          <div className="mt-1 flex items-end gap-3">
            <span className="text-2xl font-semibold text-gray-100">
              {m.backlog.current ?? "—"}
            </span>
            {hasTrend && (
              <div className="flex-1">
                <Sparkline values={values} stroke="#00d6ff" height={40} />
              </div>
            )}
          </div>
        </div>
        <Tile label="Policies learned" value={m.policiesLearned} accent="text-[#00d6ff]" />
        <Tile label="Changes written" value={m.changesWritten} />
      </div>
      {m.openDecisions > 0 && (
        <p className="mt-3 text-xs text-amber-300/80">
          {m.openDecisions} open decision{m.openDecisions === 1 ? "" : "s"} waiting on you.
        </p>
      )}
    </section>
  );
}
