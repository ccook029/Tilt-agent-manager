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
import CarVoiceMode from "@/components/voice/car-voice-mode";
import { streamVoiceReply } from "@/lib/voice/voice-client";

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

// ---------------------------------------------------------------------------
// Voice replies (Listen) — natural per-agent server voice with a browser
// speech-synthesis fallback. Mirrors the generic employee chat so Sterling and
// Penny read aloud the same way every other employee does.
// ---------------------------------------------------------------------------
const SPEECH_RATE = 1.0;

function speakableText(text: string): string {
  return text
    .replace(/```json[\s\S]*?```/g, " ")
    .replace(/```[\s\S]*?```/g, " — details on screen — ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2600);
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  if (!voices.length) return null;
  const prefer = ["Natural", "Google US English", "Samantha", "Aria", "Zira"];
  for (const hint of prefer) {
    const hit = voices.find((v) => v.name.includes(hint));
    if (hit) return hit;
  }
  return voices.find((v) => v.default) ?? voices[0];
}

export default function AgentChat({
  config,
  enableVoice = false,
}: {
  config: AgentChatConfig;
  /** Show the hands-free Voice Mode toggle (car use). */
  enableVoice?: boolean;
}) {
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

  // Voice (Listen) — which message is speaking, plus playback plumbing.
  const [speaking, setSpeaking] = useState(false);
  const [speechFor, setSpeechFor] = useState<number | null>(null);
  const keepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Generation counter: each speak()/stop bumps it so a superseded in-flight
  // request abandons instead of playing over newer audio.
  const speechGenRef = useRef(0);

  const stopAllAudio = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src.startsWith("blob:")) URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    speechGenRef.current++;
    stopAllAudio();
    setSpeaking(false);
    setSpeechFor(null);
  }, [stopAllAudio]);

  // Stop any speech when leaving the page.
  useEffect(() => stopAllAudio, [stopAllAudio]);

  const speakWithBrowser = useCallback((clean: string) => {
    if (!("speechSynthesis" in window)) {
      setSpeaking(false);
      setSpeechFor(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = SPEECH_RATE;
    const done = () => {
      setSpeaking(false);
      setSpeechFor(null);
      if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    };
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
    // Chrome stops long utterances after ~15s; a periodic resume() keeps it going.
    keepaliveRef.current = setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
      else if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    }, 10_000);
  }, []);

  const speak = useCallback(
    (text: string, msgIndex: number) => {
      const clean = speakableText(text);
      if (!clean) return;
      const gen = ++speechGenRef.current;
      stopAllAudio();
      setSpeaking(true);
      setSpeechFor(msgIndex);
      const url = `/api/agents/tts?agentId=${encodeURIComponent(config.agent)}&text=${encodeURIComponent(clean)}`;
      const audio = new Audio(url);
      audio.playbackRate = SPEECH_RATE;
      if ("preservesPitch" in audio) audio.preservesPitch = true;
      const done = () => {
        if (speechGenRef.current === gen) {
          setSpeaking(false);
          setSpeechFor(null);
        }
      };
      audio.onended = done;
      // Server error / no TTS key — fall back to the browser voice unless a
      // newer click already took over.
      audio.onerror = () => {
        if (speechGenRef.current === gen) speakWithBrowser(clean);
      };
      audioRef.current = audio;
      audio.play().catch(() => {
        if (speechGenRef.current === gen) speakWithBrowser(clean);
      });
    },
    [config.agent, stopAllAudio, speakWithBrowser]
  );

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

  // Core send — posts to the SAME CFO route the typed chat uses, appends both
  // turns to the on-screen + KV transcript, and RETURNS the reply text so Voice
  // Mode can read it aloud. `voice: true` asks the backend for a concise,
  // spoken-friendly answer (same brain and context, shorter delivery).
  const sendMessage = useCallback(
    async (text: string, opts: { voice?: boolean } = {}): Promise<string> => {
      const t = text.trim();
      if (!t) return "";
      setMessages((p) => [...p, { role: "user", content: t, timestamp: new Date().toISOString() }]);
      setLoading(true);
      try {
        const res = await fetch("/api/accounting-manager/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "chat", agent: config.agent, message: t, voice: opts.voice }),
        });
        const data = await res.json();
        const extras: string[] = [];
        if (Array.isArray(data.recordedPolicies) && data.recordedPolicies.length > 0) {
          extras.push(`📋 Recorded as standing policy: ${data.recordedPolicies.length} decision(s).`);
        }
        if (data.dispatched) {
          extras.push(`⚙️ Penny is now running "${data.dispatched}" — results will appear in her Report History shortly.`);
        }
        const body = [data.reply ?? data.error ?? "", ...extras].filter(Boolean).join("\n\n");
        const content =
          body.trim() ||
          "Hmm — I didn't get a response back that time. Try sending that again.";
        setMessages((p) => [
          ...p,
          { role: "assistant", content, timestamp: new Date().toISOString() },
        ]);
        if (Array.isArray(data.open)) setOpen(data.open);
        return content;
      } catch {
        const content = "Connection error — try again.";
        setMessages((p) => [
          ...p,
          { role: "assistant", content, timestamp: new Date().toISOString() },
        ]);
        return content;
      } finally {
        setLoading(false);
      }
    },
    [config.agent]
  );

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await sendMessage(text);
  };

  // Voice Mode reads the reply aloud, so it wants the concise variant.
  const sendVoice = useCallback((text: string) => sendMessage(text, { voice: true }), [sendMessage]);

  // Real-time streaming path for Voice Mode: shows the turn in the transcript
  // and streams deltas back so the overlay can speak sentence-by-sentence. The
  // streaming route persists to the SAME KV transcript, so nothing is doubled.
  const streamReply = useCallback(
    async (message: string, handlers: { onDelta: (delta: string) => void }): Promise<string> => {
      setMessages((p) => [...p, { role: "user", content: message, timestamp: new Date().toISOString() }]);
      let full = "";
      try {
        full = await streamVoiceReply(message, { onDelta: handlers.onDelta });
      } catch {
        full = "Sorry — I couldn't reach you just now. Try again.";
      }
      const content = full.trim() || "…";
      setMessages((p) => [...p, { role: "assistant", content, timestamp: new Date().toISOString() }]);
      return content;
    },
    []
  );

  const [voiceOpen, setVoiceOpen] = useState(false);

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
        <div className="flex items-center gap-2">
          {enableVoice && (
            <button
              onClick={() => {
                stopSpeaking(); // don't let a Listen playback overlap Voice Mode
                setVoiceOpen(true);
              }}
              title="Hands-free voice conversation — built for driving"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-[#00d6ff]/15 border border-[#00d6ff]/40 text-[#00d6ff] hover:bg-[#00d6ff]/25 transition-colors"
            >
              🎙 Voice
            </button>
          )}
          <button
            onClick={newChat}
            disabled={loading}
            title="Start a fresh conversation (the saved transcript is cleared; recorded policies are kept)"
            className="text-[11px] px-2.5 py-1 rounded-md bg-gray-800/70 border border-gray-700/60 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
          >
            ↺ New chat
          </button>
        </div>
      </div>

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
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] text-gray-600">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
                {msg.role === "assistant" && msg.content.trim() && (
                  <button
                    onClick={() =>
                      speechFor === i && speaking ? stopSpeaking() : speak(msg.content, i)
                    }
                    title={speechFor === i && speaking ? "Stop" : "Read this reply out loud"}
                    aria-label={speechFor === i && speaking ? "Stop" : "Read this reply out loud"}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                      speechFor === i && speaking
                        ? "border-amber-700/60 bg-amber-950/40 text-amber-400 hover:text-amber-300"
                        : "border-gray-700 bg-gray-900/60 text-gray-400 hover:border-[#00d6ff]/50 hover:text-[#00d6ff]"
                    }`}
                  >
                    {speechFor === i && speaking ? "◼ Stop" : "▶ Listen"}
                  </button>
                )}
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

      {/* Open questions awaiting Chris — kept BELOW the chat so the conversation
          leads and his decision queue sits underneath it. */}
      {open.length > 0 && (
        <div className="border-t border-gray-800 bg-amber-950/20 p-3 space-y-3">
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

      {/* Hands-free Voice Mode overlay — same backend, context, and KV history
          as the typed chat above (sendVoice → sendMessage). */}
      {enableVoice && voiceOpen && (
        <CarVoiceMode
          agentId={config.agent}
          agentName={config.name}
          // Sterling streams (snappy, sentence-by-sentence); anyone else falls
          // back to the buffered concise send.
          streamReply={config.agent === "sterling" ? streamReply : undefined}
          sendMessage={sendVoice}
          onClose={() => setVoiceOpen(false)}
        />
      )}
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
