"use client";

import { useEffect, useState, useCallback } from "react";

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

export default function DashboardPage() {
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/logs");
      const data = await res.json();
      setLogs(data.logs ?? []);
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
        <h2 className="text-2xl font-semibold">Agent Dashboard</h2>
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
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No agent runs yet</p>
          <p className="text-sm">
            Add agents to{" "}
            <code className="bg-gray-800 px-1 rounded">src/agents/</code> and
            trigger a run.
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
                  <span className="text-xs text-gray-500">
                    {log.model}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <span>{(log.durationMs / 1000).toFixed(1)}s</span>
                  {log.tokensUsed && (
                    <span>{log.tokensUsed} tokens</span>
                  )}
                  <span>
                    {new Date(log.startedAt).toLocaleString()}
                  </span>
                </div>
              </button>
              {expanded === log.id && (
                <div className="px-4 py-3 border-t border-gray-800 bg-gray-900">
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap max-h-96 overflow-y-auto">
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
