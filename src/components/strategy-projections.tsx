"use client";

// ---------------------------------------------------------------------------
// StrategyProjections — the revenue outlook built from Sterling's contract
// pipeline. Committed / probability-weighted / best-case totals plus a
// month-by-month table with a lightweight inline bar chart.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

interface MonthRow {
  month: string;
  committed: number;
  weighted: number;
  best: number;
}

interface Projection {
  months: MonthRow[];
  horizonMonths: number;
  totals: { committed: number; weighted: number; best: number };
  generatedAt: string;
}

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export default function StrategyProjections() {
  const [projection, setProjection] = useState<Projection | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/strategy/contracts?months=12");
      const data = await res.json().catch(() => ({}));
      setProjection(data.projection ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const months = projection?.months ?? [];
  const totals = projection?.totals ?? { committed: 0, weighted: 0, best: 0 };
  const maxWeighted = Math.max(1, ...months.map((m) => m.weighted));
  const allZero =
    totals.committed === 0 && totals.weighted === 0 && totals.best === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">
          Projected revenue over the next {projection?.horizonMonths ?? 12}{" "}
          months, built from your contract pipeline.
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-[#00d6ff]/40 hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5">
          <p className="text-xs uppercase tracking-wider text-gray-600">
            Committed
          </p>
          <p className="mt-2 text-2xl font-semibold text-gray-200">
            {money(totals.committed)}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5">
          <p className="text-xs uppercase tracking-wider text-gray-600">
            Probability-weighted
          </p>
          <p className="mt-2 text-2xl font-semibold text-[#00d6ff]">
            {money(totals.weighted)}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5">
          <p className="text-xs uppercase tracking-wider text-gray-600">
            Best-case
          </p>
          <p className="mt-2 text-2xl font-semibold text-amber-400">
            {money(totals.best)}
          </p>
        </div>
      </div>

      {/* Monthly table */}
      <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 overflow-hidden">
        {loading ? (
          <p className="px-5 py-8 text-sm text-gray-600">Loading…</p>
        ) : allZero ? (
          <p className="px-5 py-8 text-sm text-gray-500">
            No expected contracts yet — add deals under Contracts to see
            projections.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800/70">
                  <th className="px-5 py-3 font-medium">Month</th>
                  <th className="px-5 py-3 font-medium text-right">Committed</th>
                  <th className="px-5 py-3 font-medium">Weighted</th>
                  <th className="px-5 py-3 font-medium text-right">Best</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr
                    key={m.month}
                    className="border-b border-gray-900 last:border-0 hover:bg-gray-900/40"
                  >
                    <td className="px-5 py-3 text-gray-300 whitespace-nowrap">
                      {m.month}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-400 tabular-nums">
                      {money(m.committed)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 min-w-[60px] rounded-full bg-gray-800/60 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#00d6ff]"
                            style={{
                              width: `${(m.weighted / maxWeighted) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-[#00d6ff] tabular-nums w-20 text-right">
                          {money(m.weighted)}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-amber-400 tabular-nums">
                      {money(m.best)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
