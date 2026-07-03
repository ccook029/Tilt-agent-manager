"use client";

// ---------------------------------------------------------------------------
// ⌘K / Ctrl-K command palette. Mounted once in the root layout.
//   - <CommandPalette/>  the overlay itself (listens for the shortcut)
//   - <CommandButton/>   a header pill that opens it via a window event
// Jump to any agent, hop between pages, or trigger "Run All Agents".
// ---------------------------------------------------------------------------
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { getAllPersonas } from "@/lib/personas";
import { useToast } from "@/components/toast";
import { SearchIcon } from "@/components/icons";
import { EASE_OUT } from "@/lib/motion";

const OPEN_EVENT = "tilt:open-command";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: "Navigate" | "Agents" | "Actions";
  perform: () => void | Promise<void>;
}

export function CommandButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="hidden sm:flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-700 rounded-md px-2.5 py-1.5 transition-colors"
      aria-label="Open command palette"
    >
      <span>Search…</span>
      <kbd className="font-sans text-[10px] bg-gray-800/80 rounded px-1 py-0.5 text-gray-400">
        ⌘K
      </kbd>
    </button>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const toast = useToast();
  const reduce = useReducedMotion();
  const personas = getAllPersonas();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      { id: "home", label: "Go to HQ Home", group: "Navigate", perform: () => router.push("/") },
      { id: "dash", label: "Go to Operations Dashboard", group: "Navigate", perform: () => router.push("/dashboard") },
      { id: "studio", label: "Go to Design Studio", group: "Navigate", perform: () => router.push("/studio") },
      { id: "studio-social", label: "Studio: Social Content", group: "Navigate", perform: () => router.push("/studio/social") },
      { id: "studio-announce", label: "Studio: Announcement Creator", group: "Navigate", perform: () => router.push("/studio/announcements") },
      { id: "studio-catalog", label: "Studio: Catalog Builder", group: "Navigate", perform: () => router.push("/studio/catalog") },
      { id: "studio-blanket", label: "Studio: Blanket Fundraiser", group: "Navigate", perform: () => router.push("/studio/blanket") },
      { id: "studio-sox", label: "Studio: SOX Creator", group: "Navigate", perform: () => router.push("/studio/sox") },
      { id: "inventory", label: "Go to Stick Inventory", group: "Navigate", perform: () => router.push("/inventory") },
      { id: "inventory-scan", label: "Inventory: Scan & Sell", group: "Navigate", perform: () => router.push("/inventory/scan") },
      { id: "files", label: "Go to Files", group: "Navigate", perform: () => router.push("/files") },
      { id: "questions", label: "Go to Questions", group: "Navigate", perform: () => router.push("/questions") },
    ];
    const agents: Command[] = personas.map((p) => ({
      id: `agent-${p.agentId}`,
      label: p.name,
      hint: `${p.title} · ${p.department}`,
      group: "Agents",
      perform: () => router.push(`/dashboard/${p.agentId}`),
    }));
    const actions: Command[] = [
      {
        id: "run-all",
        label: "Run All Agents",
        hint: "Dispatch every active agent",
        group: "Actions",
        perform: async () => {
          toast({ title: "Dispatching all agents…", kind: "info" });
          try {
            const r = await fetch("/api/agents/run", { method: "POST" });
            toast(
              r.ok
                ? { title: "Agents dispatched", kind: "success" }
                : { title: "Some agents failed to start", kind: "error" }
            );
          } catch {
            toast({ title: "Failed to trigger agents", kind: "error" });
          }
        },
      },
    ];
    return [...nav, ...agents, ...actions];
  }, [personas, router, toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.hint?.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q)
    );
  }, [commands, query]);

  // Global shortcut + external open event
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const run = useCallback(
    (cmd?: Command) => {
      if (!cmd) return;
      close();
      cmd.perform();
    },
    [close]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[14vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={close}
          />
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-gray-800 bg-[#141414]/95 shadow-2xl"
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2 border-b border-gray-800 px-4">
              <span className="text-gray-600">
                <SearchIcon />
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents, actions, pages…"
                className="flex-1 bg-transparent py-3.5 text-sm text-gray-200 placeholder:text-gray-600 outline-none"
              />
              <kbd className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-500">
                Esc
              </kbd>
            </div>

            <div className="max-h-80 overflow-y-auto chat-scroll py-2">
              {filtered.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-600">
                  No matches
                </p>
              ) : (
                filtered.map((c, i) => (
                  <button
                    key={c.id}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(c)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                      i === active ? "bg-[#00d6ff]/15" : "hover:bg-white/5"
                    }`}
                  >
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-sm ${
                          i === active ? "text-white" : "text-gray-300"
                        }`}
                      >
                        {c.label}
                      </span>
                      {c.hint && (
                        <span className="block truncate text-xs text-gray-600">
                          {c.hint}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-gray-600">
                      {c.group}
                    </span>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
