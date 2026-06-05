"use client";

import { useState, useRef, useEffect } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const TASK_LABELS: Record<string, string> = {
  "product-spec": "Product Spec",
  "rfq-package": "RFQ Package",
  "catalog-update": "Catalog Update",
  "rendering-brief": "Rendering Brief",
  "sell-sheet": "Sell Sheet",
  chat: "Chat",
};

export default function MayaChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hey — Maya here. Tell me what you need: a product spec, RFQ package, catalog update, rendering brief, or sell sheet. Or just describe a product idea and I'll figure out the right format.",
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [taskType, setTaskType] = useState("chat");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/product-design/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: taskType === "chat" ? "product-spec" : taskType,
          context: text,
          product_name: "Chat Request",
          email: false,
        }),
      });
      const data = await res.json();
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.report ?? data.error ?? "Something went wrong.",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Connection error — try again.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden bg-[#0d0d0d]">
      {/* Chat header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-[#111]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-600 ring-2 ring-emerald-400 flex items-center justify-center text-xs font-bold text-white">
            MB
          </div>
          <div>
            <span className="text-sm font-semibold text-white">
              Talk to Maya
            </span>
            <span className="text-xs text-gray-500 ml-2">
              Head of Product Design
            </span>
          </div>
        </div>

        {/* Task type selector */}
        <select
          value={taskType}
          onChange={(e) => setTaskType(e.target.value)}
          className="text-xs bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-gray-300 focus:outline-none focus:border-[#00d6ff]"
        >
          {Object.entries(TASK_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="h-[400px] overflow-y-auto p-4 space-y-4 chat-scroll"
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
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
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
              </span>
              <span className="ml-2 text-xs">Maya is working on this...</span>
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
            placeholder="Describe a product, ask for specs, or request an RFQ..."
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
