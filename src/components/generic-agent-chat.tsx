"use client";

// ---------------------------------------------------------------------------
// GenericAgentChat — "talk to any agent" panel. Persistent transcript (KV),
// the agent's persona + company knowledge + recent reports as grounding, and
// markdown-rendered replies. Used by every non-accounting agent's page.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReportRenderer from "@/components/report-renderer";
import { getEmployeeById } from "@/lib/org/directory";

interface Msg {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// ```assign blocks — a boss can hand out work from the chat. Each block is
// JSON {assignee, title, brief}; we render it as a card with one button that
// creates + runs the work order (worker → boss review → Chris's queue).
// ---------------------------------------------------------------------------
interface AssignSpec {
  assignee: string;
  title: string;
  brief: string;
}

function parseAssistant(content: string): (string | AssignSpec)[] {
  const parts: (string | AssignSpec)[] = [];
  const re = /```assign\s*([\s\S]*?)```/g;
  let last = 0;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    try {
      const raw = JSON.parse(m[1].trim()) as Partial<AssignSpec>;
      if (raw.assignee && raw.title && raw.brief) {
        parts.push({ assignee: raw.assignee, title: raw.title, brief: raw.brief });
      } else {
        parts.push(m[0]);
      }
    } catch {
      parts.push(m[0]); // malformed — show the raw block rather than hide it
    }
    last = re.lastIndex;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts;
}

function AssignCard({ spec }: { spec: AssignSpec }) {
  const employee = getEmployeeById(spec.assignee);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    setState("busy");
    try {
      const res = await fetch("/api/org/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeId: spec.assignee,
          title: spec.title,
          brief: spec.brief,
          run: true,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const s = d.order?.status as string | undefined;
        setState("done");
        setNote(
          s === "escalated"
            ? "Done — it raised a question in your Review queue."
            : s === "error"
              ? "It errored — check the Review queue's problem section."
              : "Done — it's in your Review queue."
        );
      } else {
        setState("error");
        setNote(d.error ?? "Failed to assign.");
      }
    } catch {
      setState("error");
      setNote("Network error — try again.");
    }
  };

  return (
    <div className="my-2 rounded-xl border border-[#0094b8]/40 bg-[#0094b8]/10 p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#00d6ff]">
        Work order → {employee?.name ?? spec.assignee}
        {employee && <span className="ml-1 font-normal normal-case text-gray-500">({employee.title})</span>}
      </p>
      <p className="mt-1 text-sm font-medium text-gray-100">{spec.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-400">{spec.brief}</p>
      <div className="mt-2.5 flex items-center gap-2">
        {state === "done" ? (
          <Link href="/review" className="text-xs font-semibold text-emerald-400 hover:underline">
            ✓ {note} Open Review queue →
          </Link>
        ) : (
          <>
            <button
              onClick={run}
              disabled={state === "busy"}
              className="rounded-md bg-[#0094b8] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#00a8d1] disabled:opacity-50"
            >
              {state === "busy" ? "Working (takes a minute)…" : "Assign & run"}
            </button>
            {note && <span className="text-[11px] text-red-400">{note}</span>}
          </>
        )}
      </div>
    </div>
  );
}

export default function GenericAgentChat({
  agentId,
  name,
  greeting,
  placeholder,
}: {
  agentId: string;
  name: string;
  greeting?: string;
  placeholder?: string;
}) {
  const intro: Msg = {
    role: "assistant",
    content: greeting ?? `Hey — it's ${name}. Ask me anything about my area.`,
  };
  const [messages, setMessages] = useState<Msg[]>([intro]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const api = useCallback(
    (payload: object) =>
      fetch(`/api/agents/${agentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    [agentId]
  );

  useEffect(() => {
    api({ mode: "history" })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.messages) && d.messages.length > 0) {
          setMessages(d.messages);
        }
      })
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await api({ mode: "chat", message: text });
      const data = await res.json().catch(() => ({}));
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply ?? data.error ?? "(no response)",
        },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network error — try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const clear = async () => {
    await api({ mode: "clear" }).catch(() => {});
    setMessages([intro]);
  };

  return (
    <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80">
      <div className="flex items-center justify-between border-b border-gray-800/70 px-4 py-2.5">
        <span className="text-sm font-medium text-gray-300">Talk to {name}</span>
        <button
          onClick={clear}
          className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
        >
          Clear
        </button>
      </div>

      <div ref={scrollRef} className="max-h-[52vh] min-h-[280px] overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[#00d6ff]/15 border border-cyan-900/50 px-3.5 py-2 text-sm text-gray-100">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="max-w-[92%]">
              {parseAssistant(m.content).map((part, j) =>
                typeof part === "string" ? (
                  part.trim() ? (
                    <ReportRenderer key={j} text={part} agentName={name} />
                  ) : null
                ) : (
                  <AssignCard key={j} spec={part} />
                )
              )}
            </div>
          )
        )}
        {loading && <p className="text-xs text-gray-600">{name} is thinking…</p>}
      </div>

      <div className="flex gap-2 border-t border-gray-800/70 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={placeholder ?? `Ask ${name} something…`}
          disabled={loading}
          className="flex-1 rounded-lg border border-gray-800 bg-[#0a0a0a] px-3 py-2 text-sm text-gray-200 focus:border-[#00d6ff] focus:outline-none"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="rounded-lg bg-[#00d6ff] px-4 py-2 text-sm font-semibold text-black hover:bg-[#33e0ff] transition-colors disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
