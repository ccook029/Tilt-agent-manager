"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getAllPersonas, type AgentPersona } from "@/lib/personas";

interface RunLog {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "error";
  output: string;
  model: string;
  tokensUsed?: number;
}

interface AgentSummary {
  agentId: string;
  name: string;
  lastRun: string;
  lastStatus: "success" | "error";
  totalRuns: number;
  model: string;
}

export default function DashboardPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const personas = getAllPersonas();

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/logs");
      const data = await res.json();
      const logs: RunLog[] = data.logs ?? [];

      const agentMap = new Map<string, AgentSummary>();
      for (const log of logs) {
        const existing = agentMap.get(log.agentId);
        if (!existing) {
          agentMap.set(log.agentId, {
            agentId: log.agentId,
            name: log.agentName.replace(/\s*\(.*\)$/, ""),
            lastRun: log.startedAt,
            lastStatus: log.status,
            totalRuns: 1,
            model: log.model,
          });
        } else {
          existing.totalRuns++;
        }
      }

      setAgents(Array.from(agentMap.values()));
    } catch {
      console.error("Failed to fetch logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const triggerAll = async () => {
    setRunning(true);
    try {
      await fetch("/api/agents/run", { method: "POST" });
      await fetchLogs();
    } catch {
      console.error("Failed to trigger agents");
    } finally {
      setRunning(false);
    }
  };

  // Merge: show all personas even if no runs yet
  const mergedCards = personas.map((person) => {
    const agentData = agents.find((a) => a.agentId === person.agentId);
    return { person, agentData };
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-gray-500 hover:text-[#e4002b] transition-colors"
          >
            &larr; HQ
          </Link>
          <h2 className="text-2xl font-bold tracking-tight">
            Operations <span className="text-[#e4002b]">Dashboard</span>
          </h2>
        </div>
        <button
          onClick={triggerAll}
          disabled={running}
          className="px-4 py-2 bg-[#e4002b] hover:bg-[#b8001f] disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
        >
          {running ? "Running..." : "Run All Agents"}
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="space-y-4">
          {mergedCards.map(({ person, agentData }) => (
            <Link
              key={person.agentId}
              href={`/dashboard/${person.agentId}`}
              className="group block rounded-xl border border-gray-800/60 hover:border-[#e4002b]/30 bg-[#111]/40 hover:bg-[#111]/70 transition-all overflow-hidden relative"
            >
              {/* Subtle red left border accent */}
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#e4002b]/0 group-hover:bg-[#e4002b]/60 transition-colors" />

              <div className="p-6 pl-7">
                <div className="flex items-start gap-5">
                  {/* Avatar */}
                  <div
                    className={`w-16 h-16 rounded-full ${person.avatarColor} ring-2 ${person.avatarAccent} flex items-center justify-center text-xl font-bold text-white shadow-lg shrink-0`}
                  >
                    {person.avatarInitials}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-semibold text-white group-hover:text-[#e4002b] transition-colors">
                        {person.name}
                      </h3>
                      <span
                        className={`flex items-center gap-1.5 text-xs ${
                          person.status === "active"
                            ? "text-green-400"
                            : "text-gray-500"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            person.status === "active"
                              ? "bg-green-500 tilt-pulse"
                              : "bg-gray-600"
                          }`}
                        />
                        {person.status === "active" ? "Active" : "Standby"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mb-2">
                      {person.title} &middot; {person.department}
                    </p>
                    <p className="text-sm text-gray-400 leading-relaxed">
                      {person.bio}
                    </p>

                    {/* Run Stats */}
                    <div className="mt-4 flex items-center gap-6 text-xs text-gray-500">
                      <span className="text-gray-600">
                        {person.schedule}
                      </span>
                      {agentData ? (
                        <>
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                agentData.lastStatus === "success"
                                  ? "bg-green-500"
                                  : "bg-red-500"
                              }`}
                            />
                            Last: {new Date(agentData.lastRun).toLocaleString()}
                          </span>
                          <span>
                            {agentData.totalRuns} report
                            {agentData.totalRuns !== 1 ? "s" : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-700 italic">
                          No reports yet
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="text-gray-700 group-hover:text-[#e4002b] transition-colors text-lg shrink-0 pt-2">
                    &rarr;
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
