"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  motion,
  AnimatePresence,
  Reorder,
  useReducedMotion,
} from "framer-motion";
import { getAllPersonas } from "@/lib/personas";
import { useToast } from "@/components/toast";
import { fireConfetti } from "@/components/confetti";
import { EASE_OUT } from "@/lib/motion";
import ActivityRail from "@/components/activity-rail";
import Magnetic from "@/components/magnetic";
import {
  AgentCardBody,
  DraggableAgentCard,
  type AgentCardData,
} from "@/components/agent-card";

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

interface AgentSummary extends AgentCardData {
  agentId: string;
  name: string;
  model: string;
}

const MotionLink = motion.create(Link);
const ORDER_KEY = "tilt.dashboard.order";
const PINNED_KEY = "tilt.dashboard.pinned";

type StatusFilter = "all" | "active" | "standby";

export default function DashboardPage() {
  const personas = getAllPersonas();
  const toast = useToast();
  const reduce = useReducedMotion();

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [order, setOrder] = useState<string[]>(() =>
    personas.map((p) => p.agentId)
  );
  const [pinned, setPinned] = useState<string[]>([]);

  // Restore saved order + pins after mount (avoids SSR mismatch).
  useEffect(() => {
    const ids = personas.map((p) => p.agentId);
    try {
      const savedOrder = JSON.parse(
        localStorage.getItem(ORDER_KEY) ?? "[]"
      ) as string[];
      const merged = [
        ...savedOrder.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !savedOrder.includes(id)),
      ];
      setOrder(merged);
      const savedPins = JSON.parse(
        localStorage.getItem(PINNED_KEY) ?? "[]"
      ) as string[];
      setPinned(savedPins.filter((id) => ids.includes(id)));
    } catch {
      /* ignore malformed storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistOrder = (next: string[]) => {
    setOrder(next);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {}
  };

  const togglePin = (id: string) => {
    const willPin = !pinned.includes(id);
    const nextPins = willPin ? [...pinned, id] : pinned.filter((x) => x !== id);
    setPinned(nextPins);
    try {
      localStorage.setItem(PINNED_KEY, JSON.stringify(nextPins));
    } catch {}
    // Pinning sends the card to the top of the order.
    if (willPin) persistOrder([id, ...order.filter((x) => x !== id)]);
  };

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
        fireConfetti();
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

  const personaById = useMemo(
    () => new Map(personas.map((p) => [p.agentId, p])),
    [personas]
  );
  const dataById = useMemo(
    () => new Map(agents.map((a) => [a.agentId, a])),
    [agents]
  );

  const isReorderable = query.trim() === "" && statusFilter === "all";

  // Ordered persona ids that currently exist.
  const orderedIds = useMemo(
    () => order.filter((id) => personaById.has(id)),
    [order, personaById]
  );

  const filteredIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orderedIds.filter((id) => {
      const p = personaById.get(id)!;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q)
      );
    });
  }, [orderedIds, personaById, query, statusFilter]);

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
          <h2 className="font-display text-3xl font-bold uppercase tracking-wide">
            Operations <span className="text-[#e4002b]">Dashboard</span>
          </h2>
        </div>
        <Magnetic>
          <button
            onClick={triggerAll}
            disabled={running}
            className="px-4 py-2 bg-[#e4002b] hover:bg-[#b8001f] disabled:opacity-50 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-[0_10px_30px_-12px_rgba(228,0,43,0.7)]"
          >
            {running && (
              <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {running ? "Running…" : "Run All Agents"}
          </button>
        </Magnetic>
      </div>

      {/* Live activity rail */}
      <ActivityRail
        personas={personas}
        agents={agents.map((a) => ({ agentId: a.agentId, lastRun: a.lastRun }))}
      />

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

      {/* Reorder hint */}
      {!loading && isReorderable && (
        <p className="text-xs text-gray-600 -mt-4">
          Drag <span className="text-gray-500">⠿</span> to reorder ·{" "}
          <span className="text-gray-500">☆</span> to pin a favorite to the top.
          Your layout is saved on this device.
        </p>
      )}

      {loading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-gray-800/60 bg-[#111]/40 animate-pulse"
            />
          ))}
        </div>
      ) : isReorderable ? (
        // Draggable, reorderable list (no active search/filter)
        <Reorder.Group
          axis="y"
          values={order}
          onReorder={persistOrder}
          className="space-y-4"
        >
          {orderedIds.map((id) => (
            <DraggableAgentCard
              key={id}
              person={personaById.get(id)!}
              agentData={dataById.get(id)}
              pinned={pinned.includes(id)}
              onTogglePin={togglePin}
            />
          ))}
        </Reorder.Group>
      ) : (
        // Filtered list (animated reflow, not draggable)
        <motion.div layout={!reduce} className="space-y-4">
          <AnimatePresence mode="popLayout" initial={false}>
            {filteredIds.map((id, i) => {
              const person = personaById.get(id)!;
              return (
                <MotionLink
                  key={id}
                  href={`/dashboard/${id}`}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: 14 }}
                  animate={
                    reduce
                      ? {}
                      : {
                          opacity: 1,
                          y: 0,
                          transition: { duration: 0.4, ease: EASE_OUT, delay: i * 0.04 },
                        }
                  }
                  exit={reduce ? {} : { opacity: 0, scale: 0.97 }}
                  whileHover={reduce ? undefined : { y: -4 }}
                  transition={{ duration: 0.28, ease: EASE_OUT }}
                  className="group block rounded-xl border border-gray-800/60 hover:border-[#e4002b]/30 bg-[#111]/40 hover:bg-[#111]/70 transition-[background-color,border-color,box-shadow] duration-300 hover:shadow-[0_16px_44px_-18px_rgba(228,0,43,0.4)] overflow-hidden relative"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#e4002b]/0 group-hover:bg-[#e4002b]/60 transition-colors" />
                  <div className="p-6 pl-7">
                    <AgentCardBody person={person} agentData={dataById.get(id)} />
                  </div>
                </MotionLink>
              );
            })}
          </AnimatePresence>

          {filteredIds.length === 0 && (
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
