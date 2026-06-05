"use client";

// ---------------------------------------------------------------------------
// RunPipeline — a bottom-center HUD that visualizes an agent run as it happens:
//   Pulling data → Building prompt → Calling Claude → Delivering report
// Mount <RunPipelineProvider> once; call useRunPipeline().run(label, fn) to
// drive it. Stages advance on a timer while `fn` is in flight; on success the
// bar completes and confetti fires, on failure it shows an error state.
// ---------------------------------------------------------------------------
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { fireConfetti } from "@/components/confetti";
import { BoltIcon, CheckIcon, XIcon } from "@/components/icons";
import { EASE_OUT } from "@/lib/motion";

const STAGES = [
  "Pulling data",
  "Building prompt",
  "Calling Claude",
  "Delivering report",
];

type Status = "running" | "done" | "error";

interface RunState {
  active: boolean;
  label: string;
  stage: number;
  status: Status;
}

type RunFn = () => Promise<{ ok: boolean }>;

const RunPipelineContext = createContext<{
  run: (label: string, fn: RunFn) => Promise<{ ok: boolean }>;
}>({ run: async () => ({ ok: false }) });

export function useRunPipeline() {
  return useContext(RunPipelineContext);
}

export function RunPipelineProvider({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const [state, setState] = useState<RunState>({
    active: false,
    label: "",
    stage: 0,
    status: "running",
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (label: string, fn: RunFn) => {
    if (hideRef.current) clearTimeout(hideRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    setState({ active: true, label, stage: 0, status: "running" });

    intervalRef.current = setInterval(() => {
      setState((s) =>
        s.status === "running"
          ? { ...s, stage: Math.min(s.stage + 1, STAGES.length - 2) }
          : s
      );
    }, 1100);

    let result = { ok: false };
    try {
      result = await fn();
    } catch {
      result = { ok: false };
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    setState((s) => ({
      ...s,
      stage: STAGES.length - 1,
      status: result.ok ? "done" : "error",
    }));
    if (result.ok) fireConfetti();
    hideRef.current = setTimeout(
      () => setState((s) => ({ ...s, active: false })),
      result.ok ? 1700 : 3200
    );
    return result;
  }, []);

  const progress =
    state.status === "done"
      ? 100
      : ((state.stage + (state.status === "error" ? 0 : 1)) / STAGES.length) * 100;

  return (
    <RunPipelineContext.Provider value={{ run }}>
      {children}
      <AnimatePresence>
        {state.active && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 30, x: "-50%" }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, x: "-50%" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 30, x: "-50%" }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
            className="fixed bottom-6 left-1/2 z-[120] w-[min(92vw,420px)] overflow-hidden rounded-2xl border border-gray-800 bg-[#121214]/95 p-4 shadow-2xl backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-md ${
                  state.status === "error"
                    ? "bg-red-500/15 text-red-400"
                    : state.status === "done"
                    ? "bg-green-500/15 text-green-400"
                    : "bg-[#00d6ff]/15 text-[#00d6ff]"
                }`}
              >
                {state.status === "error" ? (
                  <XIcon className="text-[13px]" />
                ) : state.status === "done" ? (
                  <CheckIcon className="text-[13px]" />
                ) : (
                  <BoltIcon className="text-[13px]" />
                )}
              </span>
              <span className="text-sm font-semibold text-white">{state.label}</span>
              <span className="ml-auto text-[11px] uppercase tracking-wider text-gray-500">
                {state.status === "done"
                  ? "Complete"
                  : state.status === "error"
                  ? "Failed"
                  : "Running"}
              </span>
            </div>

            {/* Progress bar */}
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-gray-800">
              <motion.div
                className={`h-full rounded-full ${
                  state.status === "error" ? "bg-red-500" : "bg-[#00d6ff]"
                }`}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: EASE_OUT }}
              />
            </div>

            {/* Stage list */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {STAGES.map((label, i) => {
                const done =
                  state.status === "done" || i < state.stage;
                const current = i === state.stage && state.status === "running";
                const failed = state.status === "error" && i === state.stage;
                return (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-full ${
                        failed
                          ? "text-red-400"
                          : done
                          ? "text-[#00d6ff]"
                          : current
                          ? "text-[#00d6ff]"
                          : "text-gray-700"
                      }`}
                    >
                      {failed ? (
                        <XIcon className="text-[11px]" />
                      ) : done ? (
                        <CheckIcon className="text-[11px]" />
                      ) : current ? (
                        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-[#00d6ff]/40 border-t-[#00d6ff]" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-700" />
                      )}
                    </span>
                    <span
                      className={
                        done || current ? "text-gray-300" : "text-gray-600"
                      }
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </RunPipelineContext.Provider>
  );
}
