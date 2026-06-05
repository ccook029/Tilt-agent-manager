"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { getAllPersonas } from "@/lib/personas";
import { useToast } from "@/components/toast";
import { EASE_OUT } from "@/lib/motion";

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

const MotionLink = motion.create(Link);

type StatusFilter = "all" | "active" | "standby";

export default function DashboardPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const personas = getAllPersonas();
  const toast = useToast();
  const reduce = useReducedMotion();

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
    toast({
      title: "Dispatching all agents…",
      description: "Kicking off every active agent.",
      kind: "info",
    });
    try {
      const res = await fetch("/api/agents/run", { method: "POST" });
      await fetchLogs();
      if (res.ok) {
        toast({ title: "Agents dispatched", kind: "success" });
      } else {
        toast({ title: "Some agents failed to start", kind: "error" });
      }
    } catch {
      toast({ title: "Failed to trigger agents", kind: "error" });
    } finally {
      setRunning(false);
    }
  };

  // Merge: show all personas even if no runs yet
  const mergedCards = useMemo(
    () =>
      personas.map((person) => ({
        person,
        agentData: agents.find((a) => a.agentId === person.agentId),
      })),
    [personas, agents]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mergedCards.filter(({ person }) => {
      if (statusFilter !== "all" && person.status !== statusFilter) return false;
      if (!q) return true;
      return (
        person.name.toLowerCase().includes(q) ||
        person.title.toLowerCase().includes(q) ||
        person.department.toLowerCase().includes(q)
      );
    });
  }, [mergedCards, query, statusFilter]);

  const statusChips: { label: string; value: StatusFilter }[] = [
    { label: "All", value: "all" },
    { label: "Active", value: "active" },
    { label: "Standby", value: "standby" },
  ];

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
          className="px-4 py-2 bg-[#e4002b] hover:bg-[#b8001f] disabled:opacity-50 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          {running && (
            <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          )}
          {running ? "Running…" : "Run All Agents"}
        </button>
      </div>

      {/* Controls: search + status filter */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm">
            ⌕
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents by name, role, or department…"
            className="w-full bg-[#111]/60 border border-gray-800/60 focus:border-[#e4002b]/40 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 outline-none transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {statusChips.map((chip) => (
            <button
              key={chip.value}
              onClick={() => setStatusFilter(chip.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === chip.value
                  ? "bg-[#e4002b]/15 border-[#e4002b]/50 text-[#ff6b87]"
                  : "bg-[#111]/40 border-gray-800/60 text-gray-500 hover:text-gray-300"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-gray-800/60 bg-[#111]/40 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <motion.div layout={!reduce} className="space-y-4">
          <AnimatePresence mode="popLayout" initial={false}>
            {filtered.map(({ person, agentData }, i) => (
              <MotionLink
                key={person.agentId}
                href={`/dashboard/${person.agentId}`}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={
                  reduce
                    ? {}
                    : {
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.45, ease: EASE_OUT, delay: i * 0.04 },
                      }
                }
                exit={reduce ? {} : { opacity: 0, scale: 0.97 }}
                whileHover={reduce ? undefined : { y: -4 }}
                transition={{ duration: 0.28, ease: EASE_OUT }}
                className="group block rounded-xl border border-gray-800/60 hover:border-[#e4002b]/30 bg-[#111]/40 hover:bg-[#111]/70 transition-[background-color,border-color,box-shadow] duration-300 hover:shadow-[0_16px_44px_-18px_rgba(228,0,43,0.4)] overflow-hidden relative"
              >
                {/* Subtle red left border accent */}
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#e4002b]/0 group-hover:bg-[#e4002b]/60 transition-colors" />

                <div className="p-6 pl-7">
                  <div className="flex items-start gap-5">
                    {/* Avatar */}
                    <div
                      className={`w-16 h-16 rounded-full ${person.avatarColor} ring-2 ${person.avatarAccent} flex items-center justify-center text-xl font-bold text-white shadow-lg shrink-0 transition-transform duration-300 group-hover:scale-105`}
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
                        <span className="text-gray-600">{person.schedule}</span>
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
                    <div className="text-gray-700 group-hover:text-[#e4002b] group-hover:translate-x-1 transition-all text-lg shrink-0 pt-2">
                      &rarr;
                    </div>
                  </div>
                </div>
              </MotionLink>
            ))}
          </AnimatePresence>

          {filtered.length === 0 && (
            <div className="text-center py-16 text-gray-600">
              <p className="text-lg mb-1">No agents match</p>
              <p className="text-sm">Try a different search or filter.</p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
