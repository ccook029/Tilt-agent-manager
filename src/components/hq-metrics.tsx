"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { CountUp } from "@/components/count-up";
import type { TiltWebBreakdownRow, TiltWebMetrics } from "@/lib/tilt-web";

interface HqMetricsData {
  generatedAt: string;
  currentMonth: { label: string; revenue: number; siteVisits: number; inquiries: number };
  previousMonth: { label: string; revenue: number; siteVisits: number; inquiries: number };
  sticksSold: {
    currentMonth: { label: string; total: number };
    previousMonth: { label: string; total: number };
    change: number | null;
  };
  dailyTrend: { day: number; revenue: number; sticks: number }[] | null;
  tiltWeb: TiltWebMetrics | null;
  changes: { revenue: number | null; siteVisits: number | null; inquiries: number | null };
  errors: { source: string; message: string }[];
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // matches the API's s-maxage

/** Segment colors for the channel split bar + legend dots. */
const CHANNEL_COLORS = ["bg-[#00d6ff]", "bg-[#8b7cff]", "bg-amber-400", "bg-emerald-400"];

/** Revenue change vs the matching row (by name) in the previous month. */
function rowChange(row: TiltWebBreakdownRow, previousRows: TiltWebBreakdownRow[]): number | null {
  const prev = previousRows.find((r) => r.name === row.name);
  if (!prev || prev.revenue <= 0) return null;
  return Math.round(((row.revenue - prev.revenue) / prev.revenue) * 1000) / 10;
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-gray-600">N/A</span>;
  const positive = value >= 0;
  return (
    <span
      className={`text-xs font-medium ${
        positive ? "text-green-400" : "text-red-400"
      }`}
    >
      {positive ? "+" : ""}
      {value}%
    </span>
  );
}

/** Tiny SVG area chart — decorative trend behind a metric. */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const gradientId = useId();
  if (values.length === 0) return null;
  const pts = values.length === 1 ? [values[0], values[0]] : values;
  const w = 100;
  const h = 28;
  const max = Math.max(...pts, 1);
  const step = w / (pts.length - 1);
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  const line = pts
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${y(v).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00d6ff" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#00d6ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke="#00d6ff"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Category breakdown — proportional horizontal bars, sorted by revenue. */
function CategoryBars({
  title,
  rows,
  previousRows,
}: {
  title: string;
  rows: TiltWebBreakdownRow[];
  previousRows: TiltWebBreakdownRow[];
}) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.revenue - a.revenue);
  const max = Math.max(...sorted.map((r) => r.revenue), 1);
  return (
    <div className="px-8 py-5">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">{title}</p>
      <div className="space-y-3">
        {sorted.map((row) => (
          <div key={row.name}>
            <div className="flex items-baseline justify-between gap-4 mb-1">
              <span className="text-sm text-gray-300 truncate">{row.name}</span>
              <span className="flex items-baseline gap-3 shrink-0">
                <span className="text-xs text-gray-600 tabular-nums">
                  {row.units.toLocaleString()} units
                </span>
                <span className="font-display text-sm font-bold text-white tabular-nums">
                  ${Math.round(row.revenue).toLocaleString()}
                </span>
                <ChangeBadge value={rowChange(row, previousRows)} />
              </span>
            </div>
            <div className="h-1 rounded-full bg-gray-800/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#00d6ff]/40 to-[#00d6ff]"
                style={{ width: `${Math.max((row.revenue / max) * 100, row.revenue > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Channel breakdown — single stacked share bar with a legend underneath. */
function ChannelSplit({
  title,
  rows,
  previousRows,
}: {
  title: string;
  rows: TiltWebBreakdownRow[];
  previousRows: TiltWebBreakdownRow[];
}) {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + r.revenue, 0);
  return (
    <div className="px-8 py-5">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">{title}</p>
      {total > 0 && (
        <div className="flex h-2 rounded-full overflow-hidden bg-gray-800/60 mb-4">
          {rows.map((row, i) => (
            <div
              key={row.name}
              className={CHANNEL_COLORS[i % CHANNEL_COLORS.length]}
              style={{ width: `${(row.revenue / total) * 100}%` }}
            />
          ))}
        </div>
      )}
      <div className="space-y-2.5">
        {rows.map((row, i) => (
          <div key={row.name} className="flex items-baseline justify-between gap-4">
            <span className="flex items-center gap-2 min-w-0">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${CHANNEL_COLORS[i % CHANNEL_COLORS.length]}`}
              />
              <span className="text-sm text-gray-300 truncate">{row.name}</span>
              {total > 0 && (
                <span className="text-xs text-gray-600 tabular-nums">
                  {Math.round((row.revenue / total) * 100)}%
                </span>
              )}
            </span>
            <span className="flex items-baseline gap-3 shrink-0">
              <span className="text-xs text-gray-600 tabular-nums">
                {row.units.toLocaleString()} units
              </span>
              <span className="font-display text-sm font-bold text-white tabular-nums">
                ${Math.round(row.revenue).toLocaleString()}
              </span>
              <ChangeBadge value={rowChange(row, previousRows)} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HqMetrics() {
  const [data, setData] = useState<HqMetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hq-metrics", { cache: "no-store" });
      setData(await r.json());
    } catch {
      // keep showing the last good data
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800/60 bg-[#111]/60 p-8 animate-pulse motion-reduce:animate-none">
        <div className="h-6 w-48 bg-gray-800 rounded mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i}>
              <div className="h-10 w-20 bg-gray-800 rounded mb-2" />
              <div className="h-4 w-24 bg-gray-800/60 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const cumulativeSticks: number[] = [];
  if (data.dailyTrend) {
    let acc = 0;
    for (const d of data.dailyTrend) {
      acc += d.sticks;
      cumulativeSticks.push(acc);
    }
  }
  const hasTrend = cumulativeSticks.length > 1 && cumulativeSticks[cumulativeSticks.length - 1] > 0;

  const updatedAt = new Date(data.generatedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="rounded-xl border border-[#00d6ff]/20 bg-[#111]/60 relative overflow-hidden">
      {/* Top red accent */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#00d6ff]/60 to-transparent" />

      {/* Status strip: live indicator, source health, refresh */}
      <div className="flex items-center justify-between px-8 pt-5">
        <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          <span className="h-2 w-2 rounded-full bg-[#00d6ff] shadow-[0_0_6px_#00d6ff] motion-safe:animate-pulse" />
          Live Metrics
        </span>
        <span className="flex items-center gap-3">
          {data.errors.length > 0 && (
            <span
              className="flex items-center gap-1.5 text-[11px] text-amber-400/90"
              title={data.errors.map((e) => `${e.source}: ${e.message}`).join("\n")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
              {data.errors.length} source{data.errors.length > 1 ? "s" : ""} degraded
            </span>
          )}
          <span className="text-xs text-gray-600 tabular-nums">Updated {updatedAt}</span>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh metrics"
            className="cursor-pointer rounded p-1 text-gray-500 hover:text-[#00d6ff] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-[#00d6ff]/60 disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`h-4 w-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.6 7.4A6.5 6.5 0 1 0 18.5 12M18.5 4v4h-4"
              />
            </svg>
          </button>
        </span>
      </div>

      {/* Sticks Sold — Hero metric */}
      <div className="px-8 pt-4 pb-6 border-b border-gray-800/40">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Sticks Sold This Month
          </span>
          <ChangeBadge value={data.sticksSold.change} />
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-display text-6xl font-bold text-[#00d6ff] tabular-nums tracking-tight">
            <CountUp value={data.sticksSold.currentMonth.total} />
          </span>
          <span className="text-sm text-gray-500">
            vs {data.sticksSold.previousMonth.total} last month
          </span>
        </div>
        {hasTrend && <Sparkline values={cumulativeSticks} className="mt-3 h-8 w-full" />}
        <p className="text-xs text-gray-600 mt-2">
          {data.sticksSold.currentMonth.label}
          {hasTrend && " — cumulative by day"}
        </p>
      </div>

      {/* Monthly metrics row */}
      <div className="grid grid-cols-3 divide-x divide-gray-800/40">
        {/* Revenue */}
        <div className="px-8 py-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Revenue</span>
            <ChangeBadge value={data.changes.revenue} />
          </div>
          <p className="font-display text-3xl font-bold text-white tabular-nums">
            <CountUp
              value={data.currentMonth.revenue}
              format={(n) => `$${Math.round(n).toLocaleString()}`}
            />
          </p>
          <p className="text-xs text-gray-600 mt-1">{data.currentMonth.label}</p>
        </div>

        {/* Site Visits */}
        <div className="px-8 py-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Site Visits</span>
            <ChangeBadge value={data.changes.siteVisits} />
          </div>
          <p className="font-display text-3xl font-bold text-white tabular-nums">
            <CountUp value={data.currentMonth.siteVisits} />
          </p>
          <p className="text-xs text-gray-600 mt-1">{data.currentMonth.label}</p>
        </div>

        {/* Inquiries */}
        <div className="px-8 py-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Inquiries</span>
            <ChangeBadge value={data.changes.inquiries} />
          </div>
          <p className="font-display text-3xl font-bold text-white tabular-nums">
            <CountUp value={data.currentMonth.inquiries} />
          </p>
          <p className="text-xs text-gray-600 mt-1">{data.currentMonth.label}</p>
        </div>
      </div>

      {/* Tilt Web staff-portal metrics — only shown once tiltweb is wired up */}
      {data.tiltWeb &&
        (data.tiltWeb.currentMonth.categories.length > 0 ||
          data.tiltWeb.currentMonth.channels.length > 0) && (
          <div className="border-t border-gray-800/40">
            <div className="px-8 pt-5 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-[#00d6ff]/80">
                Tilt Web — Staff Portal
              </span>
              <span className="text-xs text-gray-600">
                {data.tiltWeb.currentMonth.label || data.currentMonth.label}
              </span>
            </div>
            <div className="grid md:grid-cols-2 md:divide-x divide-gray-800/40">
              <CategoryBars
                title="Sales by Category"
                rows={data.tiltWeb.currentMonth.categories}
                previousRows={data.tiltWeb.previousMonth.categories}
              />
              <ChannelSplit
                title="Sales by Channel"
                rows={data.tiltWeb.currentMonth.channels}
                previousRows={data.tiltWeb.previousMonth.channels}
              />
            </div>
          </div>
        )}
    </div>
  );
}
