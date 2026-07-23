"use client";

// ---------------------------------------------------------------------------
// /strategy — Chris's private CFO / financial-analyst area (agent "Sterling").
// Owner-gated: only the accounting owner sees the console; everyone else gets
// a Restricted panel. Tabs: Analyst, Projections, Contracts, Knowledge.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReportRenderer from "@/components/report-renderer";
import CfoChat from "@/components/cfo-chat";
import PennyActivity from "@/components/penny-activity";
import StrategyProjections from "@/components/strategy-projections";
import StrategyContracts from "@/components/strategy-contracts";
import StrategyKnowledge from "@/components/strategy-knowledge";

type Tab = "analyst" | "projections" | "contracts" | "knowledge";
type ReportKind = "growth" | "projection" | "briefing";

const TABS: { id: Tab; label: string }[] = [
  { id: "analyst", label: "Analyst" },
  { id: "projections", label: "Projections" },
  { id: "contracts", label: "Contracts" },
  { id: "knowledge", label: "Knowledge" },
];

const REPORTS: { kind: ReportKind; label: string }[] = [
  { kind: "growth", label: "Growth strategy" },
  { kind: "projection", label: "Projection briefing" },
  { kind: "briefing", label: "Financial briefing" },
];

export default function StrategyPage() {
  const [ready, setReady] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [tab, setTab] = useState<Tab>("analyst");
  // Bump this to force <StrategyProjections /> to remount and refetch when a
  // contract changes on the Contracts tab.
  const [projectionsKey, setProjectionsKey] = useState(0);

  useEffect(() => {
    fetch("/api/os/me")
      .then((r) => r.json())
      .then((d) => {
        setRestricted(Boolean(d.authEnabled) && !d.isAccountingOwner);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const reloadProjections = useCallback(
    () => setProjectionsKey((k) => k + 1),
    []
  );

  if (!ready) {
    return <p className="text-gray-500">Loading…</p>;
  }

  if (restricted) {
    return (
      <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-8 text-center">
        <p className="mb-1 text-lg text-gray-300">Restricted</p>
        <p className="text-sm text-gray-500">
          The Strategy area is limited to the accounting owner. If a specific
          question was assigned to you, you&apos;ll find it under{" "}
          <Link href="/questions" className="text-[#00d6ff] hover:underline">
            Questions
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
          Strategy
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Sterling — your Tilt financial analyst
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-800/60 overflow-x-auto [&>*]:shrink-0">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                active ? "text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t.label}
              {active && (
                <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-[#00d6ff]" />
              )}
            </button>
          );
        })}
      </div>

      {tab === "analyst" && <AnalystTab />}
      {tab === "projections" && <StrategyProjections key={projectionsKey} />}
      {tab === "contracts" && (
        <StrategyContracts onChange={reloadProjections} />
      )}
      {tab === "knowledge" && <StrategyKnowledge />}
    </div>
  );
}

function AnalystTab() {
  const [report, setReport] = useState("");
  const [running, setRunning] = useState<ReportKind | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(false);

  const runReport = async (kind: ReportKind) => {
    setRunning(kind);
    abortRef.current = false;
    try {
      const res = await fetch("/api/strategy/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!abortRef.current) setReport(data.report ?? "");
    } finally {
      setRunning(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">
          Talk to Sterling about strategy, projections, and reports.
        </p>
        <div className="flex items-center gap-4">
          <Link
            href="/accounting/ap"
            className="text-xs text-gray-500 transition-colors hover:text-[#00d6ff]"
            title="Penny reads AP bills from the Zoho Documents inbox and proposes entries for your approval"
          >
            AP Inbox ↗
          </Link>
          <Link
            href="/zoho/reconnect"
            className="text-xs text-gray-500 transition-colors hover:text-[#00d6ff]"
            title="Refresh the Zoho connection if agents report auth / 401 errors"
          >
            Reconnect Zoho ↗
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {REPORTS.map((r) => (
          <button
            key={r.kind}
            onClick={() => runReport(r.kind)}
            disabled={running !== null}
            className="rounded-lg border border-gray-700/60 bg-gray-800/80 px-4 py-2 text-sm font-medium transition-all hover:border-[#00d6ff]/40 hover:bg-gray-700 disabled:opacity-50"
          >
            {running === r.kind ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                Running…
              </span>
            ) : (
              r.label
            )}
          </button>
        ))}
      </div>

      {report && (
        <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5">
          <div className="mb-3 flex justify-end">
            <button
              onClick={copy}
              className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-400 transition-colors hover:border-[#00d6ff]/40 hover:text-gray-200"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <ReportRenderer text={report} />
        </div>
      )}

      <CfoChat />

      {/* Live view of what Sterling has put Penny on — and everything she's done. */}
      <PennyActivity />
    </div>
  );
}
