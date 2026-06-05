"use client";

// ---------------------------------------------------------------------------
// Agent card pieces shared by the dashboard.
//   - AgentCardBody:     the avatar + info + run-stats visual (reused by both
//                        the static/filtered list and the draggable list).
//   - DraggableAgentCard: a Reorder.Item with a drag handle + pin toggle.
// ---------------------------------------------------------------------------
import Link from "next/link";
import { Reorder, useDragControls, useReducedMotion } from "framer-motion";
import type { AgentPersona } from "@/lib/personas";

export interface AgentCardData {
  lastRun: string;
  lastStatus: "success" | "error";
  totalRuns: number;
}

export function AgentCardBody({
  person,
  agentData,
}: {
  person: AgentPersona;
  agentData?: AgentCardData;
}) {
  return (
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
          <h3 className="text-lg font-semibold text-white group-hover:text-[#00d6ff] transition-colors">
            {person.name}
          </h3>
          <span
            className={`flex items-center gap-1.5 text-xs ${
              person.status === "active" ? "text-green-400" : "text-gray-500"
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
        <p className="text-sm text-gray-400 leading-relaxed">{person.bio}</p>

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
            <span className="text-gray-700 italic">No reports yet</span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <div className="text-gray-700 group-hover:text-[#00d6ff] group-hover:translate-x-1 transition-all text-lg shrink-0 pt-2">
        &rarr;
      </div>
    </div>
  );
}

export function DraggableAgentCard({
  person,
  agentData,
  pinned,
  onTogglePin,
}: {
  person: AgentPersona;
  agentData?: AgentCardData;
  pinned: boolean;
  onTogglePin: (agentId: string) => void;
}) {
  const controls = useDragControls();
  const reduce = useReducedMotion();

  return (
    <Reorder.Item
      value={person.agentId}
      dragListener={false}
      dragControls={controls}
      className="list-none"
      whileDrag={
        reduce
          ? undefined
          : {
              scale: 1.02,
              boxShadow: "0 22px 55px -22px rgba(0,214,255,0.55)",
              cursor: "grabbing",
            }
      }
    >
      <div className="group relative rounded-xl border border-gray-800/60 hover:border-[#00d6ff]/30 bg-[#111]/40 hover:bg-[#111]/70 transition-[background-color,border-color] duration-300 overflow-hidden">
        {/* Red left accent */}
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#00d6ff]/0 group-hover:bg-[#00d6ff]/60 transition-colors" />

        {/* Drag handle */}
        <button
          onPointerDown={(e) => controls.start(e)}
          className="absolute left-1.5 top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing px-1 text-lg leading-none text-gray-700 hover:text-gray-400 transition-colors touch-none"
          aria-label={`Drag to reorder ${person.name}`}
          title="Drag to reorder"
        >
          ⠿
        </button>

        {/* Pin toggle */}
        <button
          onClick={() => onTogglePin(person.agentId)}
          className={`absolute right-3 top-3 z-10 text-sm transition-colors ${
            pinned
              ? "text-[#00d6ff] hover:text-[#7be9ff]"
              : "text-gray-700 hover:text-gray-400"
          }`}
          aria-label={pinned ? `Unpin ${person.name}` : `Pin ${person.name}`}
          title={pinned ? "Unpin" : "Pin to top"}
        >
          {pinned ? "★" : "☆"}
        </button>

        <Link href={`/dashboard/${person.agentId}`} className="block p-6 pl-9">
          <AgentCardBody person={person} agentData={agentData} />
        </Link>
      </div>
    </Reorder.Item>
  );
}
