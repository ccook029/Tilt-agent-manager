"use client";

// ---------------------------------------------------------------------------
// SignalsFeed — the live cross-tool ticker on the dashboard. Everything any
// Tilt tool pushes into the signals inbox (Social Studio plans, catalog
// builds, stick sales, announcement drafts, satellite pushes) shows up here
// within the last-26h window. Renders nothing while empty so the dashboard
// stays clean pre-integration.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";

interface Signal {
  at: string;
  source: string;
  headline: string;
  detail?: string;
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

export default function SignalsFeed() {
  const [signals, setSignals] = useState<Signal[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/signals")
        .then((r) => (r.ok ? r.json() : { signals: [] }))
        .then((d) => {
          if (alive) setSignals(d.signals ?? []);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (signals.length === 0) return null;

  return (
    <section className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-4">
      <h2 className="text-xs uppercase tracking-widest text-gray-600 mb-3">
        Signals — last 24h across Tilt tools
      </h2>
      <ul className="space-y-2">
        {signals.slice(0, 8).map((s, i) => (
          <li key={`${s.at}-${i}`} className="flex items-baseline gap-3 text-sm">
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-[#00d6ff] border border-cyan-900/60 rounded-full px-2 py-0.5">
              {s.source}
            </span>
            <span className="text-gray-300">{s.headline}</span>
            {s.detail && <span className="text-gray-600 truncate">{s.detail}</span>}
            <span className="ml-auto shrink-0 text-xs text-gray-600">
              {timeAgo(s.at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
