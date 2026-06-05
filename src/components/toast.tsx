"use client";

// ---------------------------------------------------------------------------
// Minimal toast system. <ToastProvider> wraps the app in the root layout;
// any client component calls useToast() to push a transient notification.
// On-brand: dark panel, Tilt-red / green / amber accent bar, slide-in motion.
// ---------------------------------------------------------------------------
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  title: string;
  description?: string;
  kind: ToastKind;
}

type PushToast = (t: { title: string; description?: string; kind?: ToastKind }) => void;

const ToastContext = createContext<PushToast>(() => {});

export function useToast(): PushToast {
  return useContext(ToastContext);
}

const ACCENT: Record<ToastKind, string> = {
  success: "bg-green-500",
  error: "bg-[#e4002b]",
  info: "bg-sky-500",
};

const ICON: Record<ToastKind, string> = {
  success: "✓",
  error: "✕",
  info: "i",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const reduce = useReducedMotion();

  const push = useCallback<PushToast>((t) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind: "info", ...t }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex w-80 max-w-[calc(100vw-3rem)] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout={!reduce}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.96 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-start gap-3 overflow-hidden rounded-xl border border-gray-800/70 bg-[#141414]/95 p-3.5 shadow-xl backdrop-blur-sm"
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${ACCENT[t.kind]}`}
              >
                {ICON[t.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-400">
                    {t.description}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
