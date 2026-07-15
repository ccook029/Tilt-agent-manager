"use client";

// ---------------------------------------------------------------------------
// CompanyTree — the org chart as the home page's centerpiece.
//
// One department at a time: the boss on top, reporting lines down to the
// team, and the department's tools/workspaces attached underneath — so a
// person walking in reads the company the way an org chart reads: who runs
// what, who reports to whom, and where the work happens.
// ---------------------------------------------------------------------------
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { fadeRise, staggerContainer } from "@/lib/motion";
import type { DepartmentTool } from "@/lib/org/types";

export interface MemberView {
  id: string;
  name: string;
  title: string;
  initials: string;
  color: string;
  accent: string;
  bio: string;
  href: string;
  isBoss: boolean;
}

export interface DepartmentView {
  id: string;
  name: string;
  mission: string;
  boss: MemberView | null;
  members: MemberView[];
  tools: DepartmentTool[];
}

function MemberCard({ m, compact }: { m: MemberView; compact?: boolean }) {
  return (
    <Link href={m.href} className="block h-full">
      <div
        className={`group h-full rounded-xl border bg-[#111]/50 transition-[background-color,border-color,box-shadow] duration-300 hover:bg-[#111]/80 hover:shadow-[0_12px_36px_-14px_rgba(0,214,255,0.4)] ${
          m.isBoss
            ? "border-[#00d6ff]/40 hover:border-[#00d6ff]/70"
            : "border-gray-800/60 hover:border-[#00d6ff]/40"
        } ${compact ? "p-4" : "p-5"}`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`${compact ? "h-10 w-10 text-sm" : "h-12 w-12 text-base"} rounded-full ${m.color} ring-2 ${m.accent} flex shrink-0 items-center justify-center font-bold text-white shadow-lg transition-transform duration-300 group-hover:scale-105`}
          >
            {m.initials}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-semibold text-white transition-colors group-hover:text-[#00d6ff]">
              {m.name}
              {m.isBoss && (
                <span className="rounded-full bg-[#0094b8]/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#00d6ff]">
                  Boss
                </span>
              )}
            </p>
            <p className="truncate text-xs text-gray-500">{m.title}</p>
          </div>
        </div>
        {!compact && (
          <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-gray-500">
            {m.bio}
          </p>
        )}
      </div>
    </Link>
  );
}

function DepartmentSection({ dept }: { dept: DepartmentView }) {
  return (
    <div className="rounded-2xl border border-gray-800/50 bg-black/20 p-5 md:p-6">
      {/* Department header */}
      <div className="mb-5 flex items-baseline gap-3">
        <h3 className="font-display text-lg font-bold uppercase tracking-wide text-gray-100">
          {dept.name}
        </h3>
        <p className="hidden truncate text-xs text-gray-600 md:block">
          {dept.mission.split(":")[0]}
        </p>
      </div>

      {dept.boss ? (
        <>
          {/* Boss */}
          <div className="mx-auto max-w-md">
            <MemberCard m={dept.boss} />
          </div>
          {/* Connector: boss → team */}
          {dept.members.length > 0 && (
            <div className="flex justify-center">
              <div className="h-6 w-px bg-gradient-to-b from-[#00d6ff]/50 to-gray-700/60" />
            </div>
          )}
        </>
      ) : (
        <p className="mb-3 text-center text-[11px] uppercase tracking-wider text-gray-600">
          Reports to leadership
        </p>
      )}

      {/* Team row under a shared horizontal rail */}
      {dept.members.length > 0 && (
        <div className={dept.boss ? "border-t border-gray-700/60 pt-4" : ""}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dept.members.map((m) => (
              <MemberCard key={m.id} m={m} compact />
            ))}
          </div>
        </div>
      )}

      {/* Tools & workspaces */}
      {dept.tools.length > 0 && (
        <div className="mt-4 border-t border-gray-800/60 pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
            Tools & workspaces
          </p>
          <div className="flex flex-wrap gap-2">
            {dept.tools.map((t) =>
              t.external ? (
                <a
                  key={t.label}
                  href={t.href}
                  target="_blank"
                  rel="noreferrer"
                  title={t.description}
                  className="rounded-full border border-gray-700 bg-gray-800/40 px-3 py-1 text-[11px] text-gray-300 transition-colors hover:border-[#00d6ff]/50 hover:text-[#00d6ff]"
                >
                  {t.label} ↗
                </a>
              ) : (
                <Link
                  key={t.label}
                  href={t.href}
                  title={t.description}
                  className="rounded-full border border-gray-700 bg-gray-800/40 px-3 py-1 text-[11px] text-gray-300 transition-colors hover:border-[#00d6ff]/50 hover:text-[#00d6ff]"
                >
                  {t.label}
                </Link>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CompanyTree({
  departments,
}: {
  departments: DepartmentView[];
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="space-y-6"
      variants={reduce ? undefined : staggerContainer()}
      initial={reduce ? undefined : "hidden"}
      animate={reduce ? undefined : "show"}
    >
      {departments.map((dept) => (
        <motion.div key={dept.id} variants={reduce ? undefined : fadeRise}>
          <DepartmentSection dept={dept} />
        </motion.div>
      ))}
    </motion.div>
  );
}
