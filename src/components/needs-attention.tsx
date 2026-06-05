"use client";

// ---------------------------------------------------------------------------
// NeedsAttention — a dismissible strip that surfaces the most recent failed
// runs so problems don't hide at the bottom of history.
// ---------------------------------------------------------------------------
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { AlertIcon } from "@/components/icons";
import { EASE_OUT } from "@/lib/motion";

export interface Failure {
  agentId: string;
  name: string;
  when: string;
}

export default function NeedsAttention({ failures }: { failures: Failure[] }) {
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {failures.length > 0 && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={reduce ? {} : { opacity: 0, height: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
          className="overflow-hidden"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-red-500/30 bg-red-500/[0.07] px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-red-300">
              <AlertIcon className="text-[15px]" />
              Needs attention
            </span>
            <span className="text-sm text-gray-400">
              {failures.length} recent {failures.length === 1 ? "failure" : "failures"}:
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {failures.slice(0, 4).map((f) => (
                <Link
                  key={f.agentId}
                  href={`/dashboard/${f.agentId}`}
                  className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs text-red-200 transition-colors hover:bg-red-500/20"
                >
                  {f.name}
                </Link>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
