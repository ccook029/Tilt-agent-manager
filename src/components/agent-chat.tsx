"use client";

// ---------------------------------------------------------------------------
// AgentChat — shared chat panel for the accounting team (Sterling & Penny).
//
// Persistent: the transcript is stored server-side (KV), reloads when you
// return, and compacts into a summary when it gets long — so the conversation
// continues across visits. Both agents share the open-questions queue, the
// policy ledger, and uploaded reference documents.
// ---------------------------------------------------------------------------
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

interface AttachedDoc {
  id: string;
  filename: string;
  uploadedAt: string;
  sheets: number;
  rows: number;
}

export interface AgentChatConfig {
  agent: "sterling" | "penny";
  name: string;
  title: string;
  initials: string;
  avatarClasses: string; // bg + ring classes
  greeting: string;
  placeholder: string;
  workingLabel: string;
}

export default function AgentChat({ config }: { config: AgentChatConfig }) {
  const greetingMsg: ChatMessage = {
    role: "assistant",
    content: config.greeting,
    timestamp: new Date().toISOString(),
  };
  const [messages, setMessages] = useState<ChatMessage[]>([greetingMsg]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<OpenEscalation[]>([]);
  const [answering, setAnswering] = useState<string | null>(null);
  const [docs, setDocs] = useState<AttachedDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/documents");
      const data = await res.json();
      setDocs(data.documents ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting-manager/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "history", agent: config.agent }),
      });
      const data = await res.json();
      const stored: ChatMessage[] = (data.messages ?? []).map(
        (m: { role: "user" | "assistant"; content: string; timestamp: string }) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })
      );
      if (stored.length > 0 || data.summary) {
        const recap: ChatMessage[] = data.summary
          ? [
              {
                role: "assistant",
                content: `📜 Recap of our earlier conversation:\n${data.summary}`,
                timestamp: new Date(0).toISOString(),
              },
            ]
          : [];
        setMessages([...recap, ...stored]);
      }
    } catch {
      /* keep the greeting */
    }
  }, [config.agent]);

  useEffect(() => {
    loadOpen();
    loadDocs();
    loadHistory();
  }, [loadOpen, loadDocs, loadHistory]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const newChat = async () => {
    if (loading) return;
    try {
      await fetch("/api/accounting-manager/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "clear-chat", agent: config.agent }),
      });
    } catch {
      /* ignore */
    }
    setMessages([{ ...greetingMsg, timestamp: new Date().toISOString() }]);
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/accounting/documents", { method: "POST", body: form });
      const data = await res.json();
      if (data.ok && typeof data.answersRecorded === "number") {
        setMessages((p) => [
          ...p,
          {
            role: "assistant",
            content: `✅ Answer sheet processed — recorded ${data.answersRecorded} decision(s) as standing policy${data.answersSkipped ? ` (${data.answersSkipped} were already resolved)` : ""}. These apply on every run going forward.`,
            timestamp: new Date().toISOString(),
          },
        ]);
        await loadOpen();
      } else if (data.ok) {
        setMessages((p) => [
          ...p,
          {
            role: "assistant",
            content: `📎 Got it — "${data.document.filename}" attached (${data.document.sheets} sheet(s), ~${data.document.rows} rows${data.document.truncated ? ", large file so I'm working from the first portion" : ""}). Tell me what you want checked against the books.`,
            timestamp: new Date().toISOString(),
          },
        ]);
        await loadDocs();
      } else {
        setMessages((p) => [
          ...p,
          {
            role: "assistant",
            content: `Couldn't read that file: ${data.error ?? "unknown error"}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch {
      setMessages((p) => [
        ...p,
        { role: "assistant", content: "Upload failed — try again.", timestamp: new Date().toISOString() },
      ]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeDoc = async (id: string) => {
    await fetch(`/api/accounting/documents?id=${id}`, { method: "DELETE" });
    await loadDocs();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setMessages((p) => [...p, { role: "user", content: text, timestamp: new Date().toISOString() }]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);
    try {
      const res = await fetch("/api/accounting-manager/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "chat", agent: config.agent, message: text }),
      });
      const data = await res.json();
      const extras: string[] = [];
      if (Array.isArray(data.recordedPolicies) && data.recordedPolicies.length > 0) {
        extras.push(`📋 Recorded as standing policy: ${data.recordedPolicies.length} decision(s).`);
      }
      if (data.dispatched) {
        extras.push(`⚙️ Penny is now running "${data.dispatched}" — results will appear in her Report History shortly.`);
      }
      const body = [data.reply ?? data.error ?? "", ...extras]
        .filter(Boolean)
        .join("\n\n");
      setMessages((p) => [
        ...p,
        {
          role: "assistant",
          // Never render an empty bubble — if the payload came back blank, say so
          // instead of showing "nothing" (which reads as a broken chat).
          content:
            body.trim() ||
            "Hmm — I didn't get a response back that time. Try sending that again.",
          timestamp: new Date().toISOString(),
        },
      ]);
      if (Array.isArray(data.open)) setOpen(data.open);
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
            content: `Recorded: "${esc.question}" → ${decision}. That's standing policy now — it won't be asked again.`,
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
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-[#111]">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-full ${config.avatarClasses} flex items-center justify-center text-xs font-bold text-white`}
          >
            {config.initials}
          </div>
          <div>
            <span className="text-sm font-semibold text-white">Talk to {config.name}</span>
            <span className="text-xs text-gray-500 ml-2">{config.title}</span>
          </div>
        </div>
        <button
          onClick={newChat}
          disabled={loading}
          title="Start a fresh conversation (the saved transcript is cleared; recorded policies are kept)"
          className="text-[11px] px-2.5 py-1 rounded-md bg-gray-800/70 border border-gray-700/60 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
        >
          ↺ New chat
        </button>
      </div>

      {/* Open questions awaiting Chris */}
      {open.length > 0 && (
        <div className="border-b border-gray-800 bg-amber-950/20 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
              {open.length} question{open.length > 1 ? "s" : ""} need your call
            </p>
            <a
              href="/api/accounting/questions"
              download
              title="Download all open questions as Excel — fill in YOUR ANSWER and upload it back with the 📎 to record everything at once"
              className="text-[11px] px-2.5 py-1 rounded-md bg-amber-600/20 border border-amber-700/50 text-amber-300 hover:bg-amber-600/30 transition-colors"
            >
              ⬇ Excel
            </a>
          </div>
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
              {config.workingLabel}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 p-3 bg-[#111]">
        {docs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {docs.map((d) => (
              <span
                key={d.id}
                title={`${d.sheets} sheet(s), ~${d.rows} rows — uploaded ${new Date(d.uploadedAt).toLocaleDateString()}`}
                className="inline-flex items-center gap-1.5 text-[11px] bg-gray-800/70 border border-gray-700/60 rounded-full px-2.5 py-1 text-gray-300"
              >
                📎 {d.filename}
                <button
                  onClick={() => removeDoc(d.id)}
                  className="text-gray-500 hover:text-red-400 transition-colors leading-none"
                  aria-label={`Remove ${d.filename}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || loading}
            title="Attach a spreadsheet (.xlsx, .xls, .csv) to check against the books"
            className="px-3 py-2.5 bg-gray-800/50 hover:bg-gray-700 border border-gray-700 hover:border-[#00d6ff]/40 disabled:opacity-40 rounded-lg text-sm text-gray-300 transition-colors"
          >
            {uploading ? (
              <span className="inline-block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin align-middle" />
            ) : (
              "📎"
            )}
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            rows={3}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={config.placeholder}
            className="flex-1 min-h-[84px] max-h-[240px] resize-y bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[#00d6ff] transition-colors leading-relaxed"
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
        <p className="text-xs text-gray-500">Recommendation: {esc.recommendation}</p>
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
