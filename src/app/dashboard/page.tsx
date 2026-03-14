"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

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

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/logs");
      const data = await res.json();
      const logs: RunLog[] = data.logs ?? [];

      // Group logs by agentId to build agent summaries
      const agentMap = new Map<string, AgentSummary>();
      for (const log of logs) {
        const existing = agentMap.get(log.agentId);
        if (!existing) {
          agentMap.set(log.agentId, {
            agentId: log.agentId,
            name: log.agentName.replace(/\s*\(.*\)$/, ""), // strip "(Weekend)" etc.
            lastRun: log.startedAt,
            lastStatus: log.status,
            totalRuns: 1,
            model: log.model,
          });
        } else {
          existing.totalRuns++;
          // logs come most-recent-first, so first seen is the latest
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            &larr; Home
          </Link>
          <h2 className="text-2xl font-semibold">Agents</h2>
        </div>
        <button
          onClick={triggerAll}
          disabled={running}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
        >
          {running ? "Running..." : "Run All Agents"}
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : agents.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No agent runs yet</p>
          <p className="text-sm">
            Add agents to{" "}
            <code className="bg-gray-800 px-1 rounded">src/agents/</code> and
            trigger a run.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <Link
              key={agent.agentId}
              href={`/dashboard/${agent.agentId}`}
              className="block border border-gray-800 rounded-lg p-5 hover:border-gray-600 hover:bg-gray-900/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    agent.lastStatus === "success"
                      ? "bg-green-500"
                      : "bg-red-500"
                  }`}
                />
                <h3 className="font-semibold">{agent.name}</h3>
              </div>
              <div className="space-y-1 text-sm text-gray-400">
                <p>
                  Last run:{" "}
                  <span className="text-gray-300">
                    {new Date(agent.lastRun).toLocaleString()}
                  </span>
                </p>
                <p>
                  Total runs:{" "}
                  <span className="text-gray-300">{agent.totalRuns}</span>
                </p>
                <p>
                  Model:{" "}
                  <span className="text-gray-300">{agent.model}</span>
                </p>
              </div>
              <div className="mt-3 text-xs text-blue-400">
                View reports &rarr;
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
