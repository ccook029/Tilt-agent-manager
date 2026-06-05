"use client";

// ---------------------------------------------------------------------------
// Animated team grid for the HQ home page. Cards stagger in on load and lift
// with a red glow on hover. Collapses to a static grid under reduced-motion.
// ---------------------------------------------------------------------------
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_OUT, fadeRise, staggerContainer } from "@/lib/motion";
import type { AgentPersona } from "@/lib/personas";

const MotionLink = motion.create(Link);

export default function TeamGrid({ team }: { team: AgentPersona[] }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="grid grid-cols-1 md:grid-cols-3 gap-5"
      variants={reduce ? undefined : staggerContainer()}
      initial={reduce ? undefined : "hidden"}
      animate={reduce ? undefined : "show"}
    >
      {team.map((person) => (
        <MotionLink
          key={person.agentId}
          href={`/dashboard/${person.agentId}`}
          variants={reduce ? undefined : fadeRise}
          whileHover={reduce ? undefined : { y: -6 }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
          className="group block rounded-xl border border-gray-800/60 p-6 hover:border-[#e4002b]/40 bg-[#111]/50 hover:bg-[#111]/80 transition-[background-color,border-color,box-shadow] duration-300 hover:shadow-[0_16px_44px_-16px_rgba(228,0,43,0.45)] relative overflow-hidden"
        >
          {/* Red glow on hover */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#e4002b]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

          <div className="relative">
            {/* Avatar + Name */}
            <div className="flex items-center gap-4 mb-4">
              <div
                className={`w-14 h-14 rounded-full ${person.avatarColor} ring-2 ${person.avatarAccent} flex items-center justify-center text-lg font-bold text-white shadow-lg transition-transform duration-300 group-hover:scale-105`}
              >
                {person.avatarInitials}
              </div>
              <div>
                <h3 className="font-semibold text-white group-hover:text-[#e4002b] transition-colors">
                  {person.name}
                </h3>
                <p className="text-xs text-gray-500">{person.title}</p>
              </div>
            </div>

            {/* Department badge */}
            <div className="mb-3">
              <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-800/60 text-gray-400 border border-gray-700/50">
                {person.department}
              </span>
            </div>

            {/* Bio */}
            <p className="text-sm text-gray-400 leading-relaxed mb-4">
              {person.bio}
            </p>

            {/* Footer */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-600">{person.schedule}</span>
              <span
                className={`flex items-center gap-1.5 ${
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
          </div>
        </MotionLink>
      ))}
    </motion.div>
  );
}
