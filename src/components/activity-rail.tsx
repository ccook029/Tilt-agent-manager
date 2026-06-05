"use client";

// ---------------------------------------------------------------------------
// Live activity rail — a slim heartbeat strip of agent chips with a radar-ping
// status dot and relative last-run time, plus a slow red sheen sweeping across.
// Purely presentational; collapses its motion under reduced-motion.
// ---------------------------------------------------------------------------
import { motion, useReducedMotion } from "framer-motion";
import type { AgentPersona } from "@/lib/personas";

export interface RailAgent {
  agentId: string;
  lastRun: string;
}

function relativeTime(iso?: string): string {
  if (!iso) return "idle";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ActivityRail({
  personas,
  agents,
}: {
  personas: AgentPersona[];
  agents: RailAgent[];
}) {
  const reduce = useReducedMotion();

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-800/60 bg-[#111]/40">
      {!reduce && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(100deg, transparent 35%, rgba(0,214,255,0.08) 50%, transparent 65%)",
            backgroundSize: "250% 100%",
            animation: "tiltSheen 7s linear infinite",
          }}
        />
      )}
      <div className="relative flex items-center gap-2 overflow-x-auto chat-scroll px-3 py-2.5">
        <span className="shrink-0 pr-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
          Live
        </span>
        {personas.map((p) => {
          const data = agents.find((a) => a.agentId === p.agentId);
          const active = p.status === "active";
          return (
            <div
              key={p.agentId}
              className="flex shrink-0 items-center gap-2 rounded-full border border-gray-800/70 bg-[#0d0d0d]/70 py-1 pl-2 pr-3"
            >
              <span className="relative flex h-2 w-2">
                {active && !reduce && (
                  <motion.span
                    className="absolute inline-flex h-full w-full rounded-full bg-green-500/60"
                    animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    active ? "bg-green-500" : "bg-gray-600"
                  }`}
                />
              </span>
              <span className="text-xs font-medium text-gray-300">{p.name}</span>
              <span className="text-[10px] text-gray-600">
                {relativeTime(data?.lastRun)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
