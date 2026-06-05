"use client";

import { useEffect, useState } from "react";
import { CountUp } from "@/components/count-up";

interface HqMetricsData {
  generatedAt: string;
  currentMonth: { label: string; revenue: number; siteVisits: number; inquiries: number };
  previousMonth: { label: string; revenue: number; siteVisits: number; inquiries: number };
  sticksSold: {
    currentMonth: { label: string; total: number };
    previousMonth: { label: string; total: number };
    change: number | null;
  };
  changes: { revenue: number | null; siteVisits: number | null; inquiries: number | null };
  errors: { source: string; message: string }[];
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

export default function HqMetrics() {
  const [data, setData] = useState<HqMetricsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hq-metrics")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800/60 bg-[#111]/60 p-8 animate-pulse">
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

  return (
    <div className="rounded-xl border border-[#e4002b]/20 bg-[#111]/60 relative overflow-hidden">
      {/* Top red accent */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#e4002b]/60 to-transparent" />

      {/* Sticks Sold — Hero metric */}
      <div className="px-8 pt-8 pb-6 border-b border-gray-800/40">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Sticks Sold This Month
          </span>
          <ChangeBadge value={data.sticksSold.change} />
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-display text-6xl font-bold text-[#e4002b] tabular-nums tracking-tight">
            <CountUp value={data.sticksSold.currentMonth.total} />
          </span>
          <span className="text-sm text-gray-500">
            vs {data.sticksSold.previousMonth.total} last month
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          {data.sticksSold.currentMonth.label}
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
    </div>
  );
}
