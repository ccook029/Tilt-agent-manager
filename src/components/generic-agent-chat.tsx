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
  /** Preview data-URLs for screenshots sent with this message (this session
   * only — the persisted transcript stores a text note instead). */
  images?: string[];
}

// ---------------------------------------------------------------------------
// Screenshot attachments — attach / paste / drop an image, downscaled in the
// browser (max 1600px, JPEG) so the request stays under Vercel's body cap.
// ---------------------------------------------------------------------------
interface Attachment {
  mediaType: string;
  data: string; // base64, no data: prefix
  preview: string; // data URL for the thumbnail
}

const MAX_ATTACHMENTS = 4;

async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (!file.type.startsWith("image/")) return null;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("bad image"));
    el.src = dataUrl;
  });

  const MAX_DIM = 1600;
  const oversized = img.width > MAX_DIM || img.height > MAX_DIM;
  // Small originals go through untouched (keeps PNG text crisp).
  if (!oversized && dataUrl.length < 900_000) {
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(0, comma); // data:image/png;base64
    return {
      mediaType: meta.slice(5, meta.indexOf(";")),
      data: dataUrl.slice(comma + 1),
      preview: dataUrl,
    };
  }

  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: out.slice(out.indexOf(",") + 1), preview: out };
}

// ---------------------------------------------------------------------------
// Voice replies — browser speech synthesis (no API, works offline). Replies
// are cleaned for the ear: no markdown symbols, no code fences, assign blocks
// become a short spoken note.
// ---------------------------------------------------------------------------
const VOICE_KEY = "tilt.chat.voice";
// Playback speed for spoken replies (applies to both the natural voice and
// the browser fallback).
const SPEECH_RATE = 1.0;

function speakableText(text: string): string {
  return text
    .replace(/```assign[\s\S]*?```/g, " I've drafted the work order — hit Assign and run when you're ready. ")
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
  const [voiceOn, setVoiceOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: Iterable<File>) => {
    const converted = await Promise.all(
      Array.from(files).map((f) => fileToAttachment(f).catch(() => null))
    );
    setAttachments((a) =>
      [...a, ...converted.filter((c): c is Attachment => c !== null)].slice(0, MAX_ATTACHMENTS)
    );
  }, []);

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const keepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    stopAllAudio();
    setSpeaking(false);
  }, [stopAllAudio]);

  // Restore the voice preference; stop any speech when leaving the page.
  useEffect(() => {
    try {
      setVoiceOn(localStorage.getItem(VOICE_KEY) === "1");
    } catch {}
    return stopAllAudio;
  }, [stopAllAudio]);

  // Fallback: the browser's built-in voice.
  const speakWithBrowser = useCallback((clean: string) => {
    if (!("speechSynthesis" in window)) {
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = SPEECH_RATE;
    const done = () => {
      setSpeaking(false);
      if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    };
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
    // Chrome quietly stops long utterances after ~15s; a periodic resume()
    // keeps it talking. Harmless elsewhere.
    keepaliveRef.current = setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
      else if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    }, 10_000);
  }, []);

  // Preferred: the natural server voice (Gemini TTS, per-employee), sped up.
  const speak = useCallback(
    (text: string) => {
      const clean = speakableText(text);
      if (!clean) return;
      stopAllAudio();
      setSpeaking(true);
      void (async () => {
        try {
          const res = await fetch("/api/agents/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: clean, agentId }),
          });
          if (!res.ok) throw new Error(`tts ${res.status}`);
          const blob = await res.blob();
          const audio = new Audio(URL.createObjectURL(blob));
          audio.playbackRate = SPEECH_RATE;
          // Keep the pitch natural at 1.5× (default in modern browsers,
          // set explicitly where supported).
          if ("preservesPitch" in audio) audio.preservesPitch = true;
          const done = () => {
            setSpeaking(false);
            if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
          };
          audio.onended = done;
          audio.onerror = done;
          audioRef.current = audio;
          await audio.play();
        } catch {
          // No key / quota / autoplay refusal — use the browser voice.
          speakWithBrowser(clean);
        }
      })();
    },
    [agentId, stopAllAudio, speakWithBrowser]
  );

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    if (!next) stopSpeaking();
    try {
      localStorage.setItem(VOICE_KEY, next ? "1" : "0");
    } catch {}
  };

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
    if ((!text && attachments.length === 0) || loading) return;
    const sending = attachments;
    setInput("");
    setAttachments([]);
    setMessages((m) => [
      ...m,
      {
        role: "user",
        content: text || "(screenshot)",
        images: sending.map((a) => a.preview),
      },
    ]);
    setLoading(true);
    try {
      const res = await api({
        mode: "chat",
        message: text,
        images: sending.map((a) => ({ mediaType: a.mediaType, data: a.data })),
      });
      const data = await res.json().catch(() => ({}));
      const reply = data.reply ?? data.error ?? "(no response)";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (voiceOn && data.reply) speak(data.reply);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network error — try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const clear = async () => {
    stopSpeaking();
    await api({ mode: "clear" }).catch(() => {});
    setMessages([intro]);
  };

  return (
    <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80">
      <div className="flex items-center justify-between border-b border-gray-800/70 px-4 py-2.5">
        <span className="text-sm font-medium text-gray-300">Talk to {name}</span>
        <div className="flex items-center gap-3">
          {speaking && (
            <button
              onClick={stopSpeaking}
              className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
            >
              ◼ Stop
            </button>
          )}
          <button
            onClick={toggleVoice}
            title="Speak replies out loud"
            className={`text-xs transition-colors ${
              voiceOn ? "text-[#00d6ff] hover:text-[#7be9ff]" : "text-gray-600 hover:text-gray-300"
            }`}
          >
            {voiceOn ? "🔊 Voice on" : "🔇 Voice off"}
          </button>
          <button
            onClick={clear}
            className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="max-h-[52vh] min-h-[280px] overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[#00d6ff]/15 border border-cyan-900/50 px-3.5 py-2 text-sm text-gray-100">
                {m.images && m.images.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {m.images.map((src, j) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={j} src={src} alt="screenshot" className="max-h-40 rounded-lg border border-cyan-900/50" />
                    ))}
                  </div>
                )}
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
              <button
                onClick={() => speak(m.content)}
                title="Read this reply out loud"
                aria-label="Read this reply out loud"
                className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-gray-800 bg-gray-900/60 px-2.5 py-0.5 text-[11px] text-gray-400 transition-colors hover:border-[#00d6ff]/50 hover:text-[#00d6ff]"
              >
                ▶ Listen
              </button>
            </div>
          )
        )}
        {loading && <p className="text-xs text-gray-600">{name} is thinking…</p>}
      </div>

      <div
        className="border-t border-gray-800/70 p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(e.dataTransfer?.files ?? []);
        }}
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.preview} alt="attachment" className="h-14 rounded-md border border-gray-700" />
                <button
                  onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}
                  aria-label="Remove screenshot"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[10px] text-gray-300 ring-1 ring-gray-600 hover:bg-red-900 hover:text-white"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(e.target.files ?? []);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading || attachments.length >= MAX_ATTACHMENTS}
            title="Attach a screenshot (or paste / drop one)"
            aria-label="Attach a screenshot"
            className="rounded-lg border border-gray-800 bg-[#0a0a0a] px-2.5 text-sm text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-200 disabled:opacity-40"
          >
            📎
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            onPaste={onPaste}
            placeholder={placeholder ?? `Ask ${name} something…`}
            disabled={loading}
            className="flex-1 rounded-lg border border-gray-800 bg-[#0a0a0a] px-3 py-2 text-sm text-gray-200 focus:border-[#00d6ff] focus:outline-none"
          />
          <button
            onClick={send}
            disabled={loading || (!input.trim() && attachments.length === 0)}
            className="rounded-lg bg-[#00d6ff] px-4 py-2 text-sm font-semibold text-black hover:bg-[#33e0ff] transition-colors disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
