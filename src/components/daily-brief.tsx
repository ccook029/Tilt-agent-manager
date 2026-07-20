"use client";

// The Daily Brief panel at the top of HQ: topline read, pressing items, and a
// standup line per employee — generated once a day (see src/lib/daily-brief.ts).
import { useEffect, useState } from "react";
import Link from "next/link";
import type { DailyBrief } from "@/lib/daily-brief";

// Inline icons — the hub keeps icons as local SVGs (see hockey-icons.tsx).
const icon = "fill-none stroke-current";
function NewspaperIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`${icon} ${className}`} viewBox="0 0 24 24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h13v14H5a1.5 1.5 0 0 1-1.5-1.5" />
      <path d="M17 8h2.5v9.5a1.5 1.5 0 0 1-3 0" />
      <path d="M7 9h7M7 12.5h7M7 16h4" />
    </svg>
  );
}
function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`${icon} ${className}`} viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11a8 8 0 1 0-2.3 6.3" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}
function AlertIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`${icon} ${className}`} viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </svg>
  );
}
function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`${icon} ${className}`} viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-[#00d6ff]",
  quiet: "bg-gray-600",
  issue: "bg-red-500",
};

export default function DailyBriefPanel() {
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function load(method: "GET" | "POST") {
    method === "POST" ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/daily-brief", { method });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.brief) setBrief(j.brief as DailyBrief);
      else setError(j.error || "Could not load the brief.");
    } catch {
      setError("Could not load the brief.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load("GET");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prettyDate = brief
    ? new Date(`${brief.date}T12:00:00`).toLocaleDateString("en-CA", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <section className="rounded-xl border border-[#00d6ff]/25 bg-[#111]/70 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#00d6ff]/70 to-transparent" />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <NewspaperIcon className="w-5 h-5 text-[#00d6ff]" />
            <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-gray-100">
              Daily Brief
            </h2>
            {prettyDate && (
              <span className="text-sm text-gray-500">{prettyDate}</span>
            )}
          </div>
          <button
            onClick={() => void load("POST")}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700/70 px-3 py-1.5 text-xs text-gray-300 hover:border-[#00d6ff]/40 hover:text-white transition-colors disabled:opacity-50"
            title="Regenerate from the latest activity"
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Regenerating…" : "Refresh"}
          </button>
        </div>

        {loading ? (
          <div className="space-y-3 animate-pulse" aria-label="Loading daily brief">
            <div className="h-4 w-3/4 rounded bg-gray-800/80" />
            <div className="h-4 w-1/2 rounded bg-gray-800/80" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-gray-800/60" />
              ))}
            </div>
          </div>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : brief ? (
          <>
            <p className="text-gray-200 mb-4">{brief.topline}</p>

            {brief.pressing.length > 0 && (
              <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-4">
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
                  <AlertIcon className="w-3.5 h-3.5" /> Pressing
                </p>
                <ol className="space-y-1.5">
                  {brief.pressing.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-100/90">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                      {p.link ? (
                        <Link href={p.link} className="hover:text-white hover:underline">
                          {p.text}
                        </Link>
                      ) : (
                        <span>{p.text}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {brief.employees.map((e) => (
                <Link
                  key={e.id}
                  href={e.href}
                  className="group flex items-start gap-3 rounded-lg border border-gray-800/60 bg-black/20 px-3.5 py-3 hover:border-[#00d6ff]/30 transition-colors"
                >
                  <div
                    className={`relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${e.color} ring-1 ${e.accent} text-xs font-bold text-white`}
                  >
                    {e.initials}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#111] ${STATUS_DOT[e.status] ?? STATUS_DOT.quiet}`}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white leading-tight">
                      {e.name}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        {e.title}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[13px] leading-snug text-gray-400 group-hover:text-gray-300">
                      {e.line}
                    </p>
                  </div>
                  <ChevronIcon className="ml-auto mt-2 h-4 w-4 shrink-0 text-gray-700 group-hover:text-[#00d6ff]/60" />
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
