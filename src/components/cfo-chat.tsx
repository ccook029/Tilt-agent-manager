"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface OpenEscalation {
  id: string;
  question: string;
  reason: string;
  recommendation?: string;
  dollarAmount?: number;
}

export default function CfoChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Sterling here — CFO. Ask me anything about the books, or answer the open questions below and I'll record your call as standing policy so I won't ask again.",
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<OpenEscalation[]>([]);
  const [answering, setAnswering] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadOpen = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting-manager/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "list" }),
      });
      const data = await res.json();
      setOpen(data.open ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadOpen();
  }, [loadOpen]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setMessages((p) => [...p, { role: "user", content: text, timestamp: new Date().toISOString() }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/accounting-manager/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "chat", message: text }),
      });
      const data = await res.json();
      setMessages((p) => [
        ...p,
        {
          role: "assistant",
          content: data.reply ?? data.error ?? "Something went wrong.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch {
      setMessages((p) => [
        ...p,
        { role: "assistant", content: "Connection error — try again.", timestamp: new Date().toISOString() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const answer = async (esc: OpenEscalation, decision: string) => {
    if (!decision.trim()) return;
    setAnswering(esc.id);
    try {
      const res = await fetch("/api/accounting-manager/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "answer", escalationId: esc.id, answer: decision }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessages((p) => [
          ...p,
          {
            role: "assistant",
            content: `Recorded: "${esc.question}" → ${decision}. That's standing policy now — I won't ask again.`,
            timestamp: new Date().toISOString(),
          },
        ]);
        await loadOpen();
      }
    } finally {
      setAnswering(null);
    }
  };

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden bg-[#0d0d0d]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3 bg-[#111]">
        <div className="w-8 h-8 rounded-full bg-slate-600 ring-2 ring-slate-400 flex items-center justify-center text-xs font-bold text-white">
          SV
        </div>
        <div>
          <span className="text-sm font-semibold text-white">Talk to Sterling</span>
          <span className="text-xs text-gray-500 ml-2">CFO &middot; Accounting Manager</span>
        </div>
      </div>

      {/* Open questions awaiting Chris */}
      {open.length > 0 && (
        <div className="border-b border-gray-800 bg-amber-950/20 p-3 space-y-3">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
            {open.length} question{open.length > 1 ? "s" : ""} need your call
          </p>
          {open.map((e) => (
            <EscalationRow key={e.id} esc={e} onAnswer={answer} busy={answering === e.id} />
          ))}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="h-[360px] overflow-y-auto p-4 space-y-4 chat-scroll">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-[#00d6ff]/20 text-gray-200 border border-[#00d6ff]/30"
                  : "bg-gray-800/60 text-gray-300 border border-gray-700/50"
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              <div className="text-[10px] text-gray-600 mt-2">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-4 py-3 text-sm text-gray-400">
              Sterling is reviewing...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 p-3 bg-[#111]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="Ask the CFO about the books, policy, or cash position..."
            className="flex-1 bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[#00d6ff] transition-colors"
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-5 py-2.5 bg-[#00d6ff] hover:bg-[#00a6c9] disabled:opacity-40 rounded-lg text-sm font-semibold transition-colors text-[#06232b]"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function EscalationRow({
  esc,
  onAnswer,
  busy,
}: {
  esc: OpenEscalation;
  onAnswer: (e: OpenEscalation, decision: string) => void;
  busy: boolean;
}) {
  const [val, setVal] = useState(esc.recommendation ?? "");
  return (
    <div className="rounded-lg border border-amber-800/40 bg-[#0d0d0d] p-3 space-y-2">
      <p className="text-sm text-gray-200">{esc.question}</p>
      {esc.recommendation && (
        <p className="text-xs text-gray-500">Sterling recommends: {esc.recommendation}</p>
      )}
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAnswer(esc, val)}
          placeholder="Your decision..."
          className="flex-1 bg-gray-800/50 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-amber-500"
          disabled={busy}
        />
        <button
          onClick={() => onAnswer(esc, val)}
          disabled={busy || !val.trim()}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded-md text-xs font-semibold text-white transition-colors"
        >
          {busy ? "Saving..." : "Decide"}
        </button>
      </div>
    </div>
  );
}
