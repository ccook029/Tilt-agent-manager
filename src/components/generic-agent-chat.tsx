"use client";

// ---------------------------------------------------------------------------
// GenericAgentChat — "talk to any agent" panel. Persistent transcript (KV),
// the agent's persona + company knowledge + recent reports as grounding, and
// markdown-rendered replies. Used by every non-accounting agent's page.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReportRenderer from "@/components/report-renderer";
import { getDepartmentById, getEmployeeById } from "@/lib/org/directory";
import CarVoiceMode from "@/components/voice/car-voice-mode";
import { streamVoiceReply } from "@/lib/voice/voice-client";

// Agents that get the hands-free, streaming Voice Mode. The Chief of Staff is
// the "walk in and ask where we're at" agent — he sees the whole company.
const VOICE_ENABLED = new Set(["chief-of-staff"]);

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
// Playback speed for spoken replies (applies to both the natural voice and
// the browser fallback).
const SPEECH_RATE = 1.0;

function speakableText(text: string): string {
  return text
    .replace(/```assign[\s\S]*?```/g, " I've drafted the work order — hit Assign and run when you're ready. ")
    .replace(/```dispatch[\s\S]*?```/g, " I've lined that department up — confirm it when you're ready. ")
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

// ```webchange blocks — the Website Manager (Nova) turns an agreed change into
// a pull request against the storefront repo.
interface WebChangeSpec {
  path: string;
  title: string;
  request: string;
}

// ```dispatch blocks — the Chief of Staff sets a whole department in motion:
// that department's head plans the period and hands work to their own team.
interface DispatchSpec {
  department: string;
  direction: string;
}

type Part = string | AssignSpec | WebChangeSpec | DispatchSpec;

function isDispatchSpec(p: Part): p is DispatchSpec {
  return typeof p !== "string" && "department" in p;
}

function parseAssistant(content: string): Part[] {
  const parts: Part[] = [];
  const re = /```(assign|webchange|dispatch)\s*([\s\S]*?)```/g;
  let last = 0;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    try {
      const raw = JSON.parse(m[2].trim()) as Record<string, string>;
      if (m[1] === "assign" && raw.assignee && raw.title && raw.brief) {
        parts.push({ assignee: raw.assignee, title: raw.title, brief: raw.brief });
      } else if (m[1] === "webchange" && raw.path && raw.title && raw.request) {
        parts.push({ path: raw.path, title: raw.title, request: raw.request });
      } else if (m[1] === "dispatch" && raw.department) {
        parts.push({ department: raw.department, direction: raw.direction ?? "" });
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

function DispatchCard({ spec }: { spec: DispatchSpec }) {
  const dept = getDepartmentById(spec.department);
  const head = dept?.managerId ? getEmployeeById(dept.managerId) : undefined;
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    setState("busy");
    setNote(null);
    try {
      const res = await fetch(
        `/api/org/departments/${encodeURIComponent(spec.department)}/dispatch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction: spec.direction, run: true }),
        }
      );
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setState("done");
        const n = d.dispatched ?? 0;
        setNote(
          n === 0
            ? "Ran, but nothing was dispatched — check the department has a staffed team."
            : `${n} work order${n === 1 ? "" : "s"} dispatched.`
        );
      } else {
        setState("error");
        setNote(d.error ?? "Dispatch failed.");
      }
    } catch {
      setState("error");
      setNote("Network error — try again.");
    }
  };

  return (
    <div className="my-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
        Set a department in motion → {dept?.name ?? spec.department}
        {head && (
          <span className="ml-1 font-normal normal-case text-gray-500">({head.name})</span>
        )}
      </p>
      {spec.direction && (
        <p className="mt-1 text-xs leading-relaxed text-gray-300">{spec.direction}</p>
      )}
      <p className="mt-1.5 text-[11px] text-gray-500">
        {head?.name ?? "The department head"} will plan the period against this and hand work
        to their own team.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        {state === "done" ? (
          <Link href="/work" className="text-xs font-semibold text-emerald-400 hover:underline">
            ✓ {note} See where it sits →
          </Link>
        ) : (
          <>
            <button
              onClick={run}
              disabled={state === "busy"}
              className="rounded-md bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {state === "busy" ? "Planning (takes a minute)…" : "Dispatch department"}
            </button>
            {note && <span className="text-[11px] text-red-400">{note}</span>}
          </>
        )}
      </div>
    </div>
  );
}

function WebChangeCard({ spec }: { spec: WebChangeSpec }) {
  const [state, setState] = useState<
    "idle" | "busy" | "done" | "shipping" | "shipped" | "error"
  >("idle");
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Set when the change is content/merchandising and Nova may ship it herself.
  const [shipPr, setShipPr] = useState<number | null>(null);

  // Poll the merge endpoint while CI runs. That endpoint re-derives the policy
  // from the PR's real files every time, so this loop can only ever ship what
  // the server independently agrees is shippable.
  useEffect(() => {
    if (state !== "shipping" || shipPr === null) return;
    let cancelled = false;
    // ~5 minutes at 8s — a storefront build lands well inside that.
    let attemptsLeft = 38;

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch("/api/web/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prNumber: shipPr, title: spec.title }),
        });
        const d = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (d.status === "merged") {
          setState("shipped");
          setNote("Live on tilthockey.com.");
          return;
        }
        if (d.status === "pending" && attemptsLeft-- > 0) {
          setNote(d.reason ?? "Waiting for the build…");
          setTimeout(tick, 8000);
          return;
        }
        // blocked / failed / out of attempts — stop and say why. The PR stays
        // open, so nothing is lost; it just needs a human.
        setState("done");
        setNote(
          d.reason ??
            (attemptsLeft <= 0
              ? "The build is taking a while — the PR is open for you to merge."
              : "Held for review.")
        );
      } catch {
        if (cancelled) return;
        setState("done");
        setNote("Couldn't reach the merge check — the PR is open for you.");
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [state, shipPr, spec.title]);

  const run = async () => {
    setState("busy");
    setNote(null);
    try {
      const res = await fetch("/api/web/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: spec.request, path: spec.path, title: spec.title }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        setPrUrl(d.prUrl ?? null);
        if (d.autoMergeable && d.prNumber) {
          setShipPr(d.prNumber);
          setState("shipping");
          setNote("Waiting for the build…");
        } else {
          setState("done");
          setNote(d.holdReason ? `Held for review — ${d.holdReason}.` : d.summary ?? null);
        }
      } else {
        setState("error");
        setNote(d.error ?? "Couldn't open the PR.");
      }
    } catch {
      setState("error");
      setNote("Network error — try again.");
    }
  };

  return (
    <div className="my-2 rounded-xl border border-[#0094b8]/40 bg-[#0094b8]/10 p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#00d6ff]">
        Website change → pull request
      </p>
      <p className="mt-1 text-sm font-medium text-gray-100">{spec.title}</p>
      <p className="mt-0.5 text-[11px] text-gray-500">{spec.path}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-400">{spec.request}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {state === "shipped" ? (
          <span className="text-xs font-semibold text-emerald-400">
            ✓ Shipped — {note}
            {prUrl && (
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1.5 font-normal text-gray-400 hover:underline"
              >
                (PR)
              </a>
            )}
          </span>
        ) : state === "shipping" ? (
          <span className="text-xs text-amber-300">
            <span className="mr-1.5 inline-block animate-pulse">●</span>
            {note ?? "Waiting for the build…"}
            {prUrl && (
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1.5 text-gray-400 hover:underline"
              >
                (PR)
              </a>
            )}
          </span>
        ) : state === "done" ? (
          <span className="text-xs text-gray-300">
            {prUrl ? (
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-emerald-400 hover:underline"
              >
                ✓ PR opened — review &amp; merge to ship →
              </a>
            ) : (
              <span className="text-emerald-400">✓ {note ?? "Done."}</span>
            )}
            {prUrl && note && (
              <span className="ml-1.5 text-gray-500">{note}</span>
            )}
          </span>
        ) : (
          <>
            <button
              onClick={run}
              disabled={state === "busy"}
              className="rounded-md bg-[#0094b8] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#00a8d1] disabled:opacity-50"
            >
              {state === "busy" ? "Opening PR…" : "Open PR"}
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
  // Generation counter: each speak()/stop bumps it; an in-flight TTS request
  // that finds itself superseded abandons instead of playing over the newer
  // audio (the double-click-Listen overlap bug).
  const speechGenRef = useRef(0);
  // Which message index is loading/playing, so its Listen button becomes Stop.
  const [speechFor, setSpeechFor] = useState<number | null>(null);

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
    speechGenRef.current++; // abandon any in-flight TTS request
    stopAllAudio();
    setSpeaking(false);
    setSpeechFor(null);
  }, [stopAllAudio]);

  // Stop any speech when leaving the page.
  useEffect(() => stopAllAudio, [stopAllAudio]);

  // Fallback: the browser's built-in voice.
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
    // Chrome quietly stops long utterances after ~15s; a periodic resume()
    // keeps it talking. Harmless elsewhere.
    keepaliveRef.current = setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
      else if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    }, 10_000);
  }, []);

  // Preferred: the natural server voice, per-employee. The audio element
  // points straight at the streaming GET endpoint, so playback starts as the
  // first chunks arrive instead of waiting for the whole clip.
  const speak = useCallback(
    (text: string, msgIndex: number) => {
      const clean = speakableText(text);
      if (!clean) return;
      const gen = ++speechGenRef.current;
      stopAllAudio();
      setSpeaking(true);
      setSpeechFor(msgIndex);
      const url = `/api/agents/tts?agentId=${encodeURIComponent(agentId)}&text=${encodeURIComponent(clean)}`;
      const audio = new Audio(url);
      audio.playbackRate = SPEECH_RATE;
      // Keep the pitch natural if sped up (default in modern browsers, set
      // explicitly where supported).
      if ("preservesPitch" in audio) audio.preservesPitch = true;
      const done = () => {
        if (speechGenRef.current === gen) {
          setSpeaking(false);
          setSpeechFor(null);
        }
      };
      audio.onended = done;
      // Server error / no TTS key — use the browser voice (unless a newer
      // click already took over).
      audio.onerror = () => {
        if (speechGenRef.current === gen) speakWithBrowser(clean);
      };
      audioRef.current = audio;
      audio.play().catch(() => {
        if (speechGenRef.current === gen) speakWithBrowser(clean);
      });
    },
    [agentId, stopAllAudio, speakWithBrowser]
  );

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
      const replyText =
        typeof data.reply === "string" && data.reply.trim() ? data.reply : null;
      const reply = replyText ?? data.error ?? "(no response — try sending that again)";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
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

  // Voice Mode: streams the reply so it's spoken sentence-by-sentence. Shows the
  // turn in the transcript; the streaming route persists to the same KV history.
  const voiceOn = VOICE_ENABLED.has(agentId);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const streamReply = useCallback(
    async (message: string, handlers: { onDelta: (delta: string) => void }): Promise<string> => {
      setMessages((m) => [...m, { role: "user", content: message }]);
      let full = "";
      try {
        full = await streamVoiceReply(message, { onDelta: handlers.onDelta, agentId });
      } catch {
        full = "Sorry — I couldn't reach you just now. Try again.";
      }
      const content = full.trim() || "…";
      setMessages((m) => [...m, { role: "assistant", content }]);
      return content;
    },
    [agentId]
  );

  return (
    <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80">
      <div className="flex items-center justify-between border-b border-gray-800/70 px-4 py-2.5">
        <span className="text-sm font-medium text-gray-300">Talk to {name}</span>
        <div className="flex items-center gap-3">
          {voiceOn && (
            <button
              onClick={() => {
                stopSpeaking();
                setVoiceOpen(true);
              }}
              title="Hands-free voice conversation — ask where things are at"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-[#00d6ff]/15 border border-[#00d6ff]/40 text-[#00d6ff] hover:bg-[#00d6ff]/25 transition-colors"
            >
              🎙 Voice
            </button>
          )}
          {speaking && (
            <button
              onClick={stopSpeaking}
              className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
            >
              ◼ Stop
            </button>
          )}
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
                ) : "path" in part ? (
                  <WebChangeCard key={j} spec={part} />
                ) : isDispatchSpec(part) ? (
                  <DispatchCard key={j} spec={part} />
                ) : (
                  <AssignCard key={j} spec={part} />
                )
              )}
              <button
                onClick={() =>
                  speechFor === i && speaking ? stopSpeaking() : speak(m.content, i)
                }
                title={speechFor === i && speaking ? "Stop" : "Read this reply out loud"}
                aria-label={speechFor === i && speaking ? "Stop" : "Read this reply out loud"}
                className={`mt-1.5 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                  speechFor === i && speaking
                    ? "border-amber-700/60 bg-amber-950/40 text-amber-400 hover:text-amber-300"
                    : "border-gray-800 bg-gray-900/60 text-gray-400 hover:border-[#00d6ff]/50 hover:text-[#00d6ff]"
                }`}
              >
                {speechFor === i && speaking ? "◼ Stop" : "▶ Listen"}
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

      {voiceOn && voiceOpen && (
        <CarVoiceMode
          agentId={agentId}
          agentName={name}
          streamReply={streamReply}
          onClose={() => setVoiceOpen(false)}
        />
      )}
    </div>
  );
}
