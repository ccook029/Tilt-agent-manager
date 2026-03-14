"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
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

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params.agentId as string;

  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/logs?agentId=${agentId}`);
      const data = await res.json();
      setLogs(data.logs ?? []);
    } catch {
      console.error("Failed to fetch logs");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const triggerReport = async () => {
    setRunning(true);
    try {
      await fetch("/api/analytics/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await fetchLogs();
    } catch {
      console.error("Failed to trigger report");
    } finally {
      setRunning(false);
    }
  };

  const agentName = logs[0]?.agentName?.replace(/\s*\(.*\)$/, "") ?? agentId;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            &larr; Agents
          </Link>
          <h2 className="text-2xl font-semibold">{agentName}</h2>
        </div>
        {agentId === "website-analytics" && (
          <button
            onClick={triggerReport}
            disabled={running}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            {running ? "Running..." : "Run Now"}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No runs found for this agent</p>
          <p className="text-sm">
            This agent hasn&apos;t produced any reports yet.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div
              key={log.id}
              className="border border-gray-800 rounded-lg overflow-hidden"
            >
              <button
                onClick={() =>
                  setExpanded(expanded === log.id ? null : log.id)
                }
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-900 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      log.status === "success"
                        ? "bg-green-500"
                        : "bg-red-500"
                    }`}
                  />
                  <span className="font-medium">{log.agentName}</span>
                  <span className="text-xs text-gray-500">{log.model}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <span>{(log.durationMs / 1000).toFixed(1)}s</span>
                  {log.tokensUsed != null && (
                    <span>{log.tokensUsed.toLocaleString()} tokens</span>
                  )}
                  <span>
                    {new Date(log.startedAt).toLocaleString()}
                  </span>
                  <span className="text-gray-600">
                    {expanded === log.id ? "▲" : "▼"}
                  </span>
                </div>
              </button>
              {expanded === log.id && (
                <div className="px-4 py-3 border-t border-gray-800 bg-gray-900">
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap max-h-[600px] overflow-y-auto leading-relaxed">
                    {log.output}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
