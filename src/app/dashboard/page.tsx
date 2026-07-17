"use client";

// ---------------------------------------------------------------------------
// /dashboard — Operations overview. The old searchable persona grid is gone
// (browse people on /org; every employee page lives at /org/[id]). This page
// keeps the live operational widgets: what needs Chris, recent failures,
// books-cleanup progress, cross-tool signals, and the activity rail.
// ---------------------------------------------------------------------------
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { getAllPersonas } from "@/lib/personas";
import Magnetic from "@/components/magnetic";
import { useRunPipeline } from "@/components/run-pipeline";
import ActivityRail from "@/components/activity-rail";
import NeedsAttention, { type Failure } from "@/components/needs-attention";
import AttentionStrip from "@/components/attention-strip";
import SignalsFeed from "@/components/signals-feed";
import ProgressMetrics from "@/components/progress-metrics";

interface RunLog {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: string;
  status: "success" | "error";
}

interface AgentSummary {
  agentId: string;
  name: string;
  lastRun: string;
  lastStatus: "success" | "error";
}

export default function DashboardPage() {
  const personas = getAllPersonas();
  const { run } = useRunPipeline();

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [running, setRunning] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/logs");
      const data = await res.json();
      const logs: RunLog[] = data.logs ?? [];
      const agentMap = new Map<string, AgentSummary>();
      for (const log of logs) {
        if (!agentMap.has(log.agentId)) {
          agentMap.set(log.agentId, {
            agentId: log.agentId,
            name: log.agentName.replace(/\s*\(.*\)$/, ""),
            lastRun: log.startedAt,
            lastStatus: log.status,
          });
        }
      }
      setAgents(Array.from(agentMap.values()));
    } catch {
      console.error("Failed to fetch logs");
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const triggerAll = () => {
    setRunning(true);
    run("All Agents", async () => {
      const res = await fetch("/api/agents/run", { method: "POST" });
      await fetchLogs();
      return { ok: res.ok };
    }).finally(() => setRunning(false));
  };

  const personaById = useMemo(
    () => new Map(personas.map((p) => [p.agentId, p])),
    [personas]
  );

  // Agents whose most recent run failed.
  const failures = useMemo<Failure[]>(
    () =>
      agents
        .filter((a) => a.lastStatus === "error")
        .map((a) => ({
          agentId: a.agentId,
          name: personaById.get(a.agentId)?.name ?? a.name,
          when: a.lastRun,
        })),
    [agents, personaById]
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-gray-500 hover:text-[#00d6ff] transition-colors"
          >
            &larr; HQ
          </Link>
          <h2 className="font-display text-3xl font-bold uppercase tracking-wide">
            Operations <span className="text-[#00d6ff]">Overview</span>
          </h2>
        </div>
        <Magnetic>
          <button
            onClick={triggerAll}
            disabled={running}
            className="px-4 py-2 bg-[#00d6ff] hover:bg-[#00a6c9] text-[#06232b] disabled:opacity-50 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 shadow-[0_10px_30px_-12px_rgba(0,214,255,0.7)]"
          >
            {running && (
              <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {running ? "Running…" : "Run All Agents"}
          </button>
        </Magnetic>
      </div>

      {/* What needs Chris — decisions + cleanup progress */}
      <AttentionStrip />

      {/* Needs attention — recent failures */}
      <NeedsAttention failures={failures} />

      {/* Books cleanup burn-down + tallies (owner-only, hidden while empty) */}
      <ProgressMetrics />

      {/* Cross-tool signals ticker (hidden while empty) */}
      <SignalsFeed />

      {/* Live activity rail */}
      <ActivityRail
        personas={personas}
        agents={agents.map((a) => ({ agentId: a.agentId, lastRun: a.lastRun }))}
      />

      {/* The people themselves live on the org chart now */}
      <Link
        href="/org"
        className="lift block rounded-lg border border-gray-800/60 p-5 hover:border-[#00d6ff]/30 bg-[#111]/30"
      >
        <h3 className="font-semibold mb-1">Looking for the team?</h3>
        <p className="text-sm text-gray-500">
          Every employee now lives on the org chart — click anyone to assign
          work, see their history, or open their chat console.
        </p>
      </Link>
    </div>
  );
}
