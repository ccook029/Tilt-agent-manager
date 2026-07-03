"use client";

// ---------------------------------------------------------------------------
// GenericAgentChat — "talk to any agent" panel. Persistent transcript (KV),
// the agent's persona + company knowledge + recent reports as grounding, and
// markdown-rendered replies. Used by every non-accounting agent's page.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import ReportRenderer from "@/components/report-renderer";

interface Msg {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
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
              <ReportRenderer text={m.content} agentName={name} />
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
