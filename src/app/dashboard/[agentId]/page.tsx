"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getPersonaByAgentId } from "@/lib/personas";

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
  const persona = getPersonaByAgentId(agentId);

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

  const triggerRun = async () => {
    if (!persona) return;
    setRunning(true);
    try {
      await fetch(persona.runEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await fetchLogs();
    } catch {
      console.error("Failed to trigger run");
    } finally {
      setRunning(false);
    }
  };

  const displayName = persona?.name ?? logs[0]?.agentName ?? agentId;

  return (
    <div className="space-y-6">
      {/* Header with persona */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-5">
          <Link
            href="/dashboard"
            className="text-gray-400 hover:text-gray-200 transition-colors mt-2"
          >
            &larr;
          </Link>

          {persona && (
            <div
              className={`w-16 h-16 rounded-full ${persona.avatarColor} ring-2 ${persona.avatarAccent} flex items-center justify-center text-xl font-bold text-white shadow-lg shrink-0`}
            >
              {persona.avatarInitials}
            </div>
          )}

          <div>
            <h2 className="text-2xl font-semibold">{displayName}</h2>
            {persona && (
              <p className="text-sm text-gray-500 mt-0.5">
                {persona.title} &middot; {persona.department}
              </p>
            )}
            {persona && (
              <p className="text-sm text-gray-400 mt-2 max-w-2xl leading-relaxed">
                {persona.bio}
              </p>
            )}
          </div>
        </div>

        {/* Run button — available for all agents, not just analytics */}
        <button
          onClick={triggerRun}
          disabled={running}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors shrink-0"
        >
          {running ? "Running..." : "Run Now"}
        </button>
      </div>

      {/* Persona meta bar */}
      {persona && (
        <div className="flex items-center gap-4 text-xs text-gray-500 border-b border-gray-800 pb-4">
          <span>Schedule: {persona.schedule}</span>
          <span
            className={`flex items-center gap-1.5 ${
              persona.status === "active" ? "text-green-400" : "text-gray-500"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                persona.status === "active"
                  ? "bg-green-500 animate-pulse"
                  : "bg-gray-600"
              }`}
            />
            {persona.status === "active" ? "Active" : "Standby"}
          </span>
          {persona.taskTypes && (
            <span>
              Tasks:{" "}
              {persona.taskTypes.map((t) => (
                <code
                  key={t}
                  className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-400 mr-1"
                >
                  {t}
                </code>
              ))}
            </span>
          )}
        </div>
      )}

      {/* Run history */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
          Report History
        </h3>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg mb-2">No reports yet</p>
            <p className="text-sm">
              {persona
                ? `${persona.name} hasn't delivered any reports yet.`
                : "This agent hasn't produced any reports yet."}
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
    </div>
  );
}
