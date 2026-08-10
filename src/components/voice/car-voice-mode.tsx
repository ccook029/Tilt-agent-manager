"use client";

// ---------------------------------------------------------------------------
// CarVoiceMode — hands-free, real-time voice conversation overlay.
//
// Full-screen, high-contrast, one giant button. Continuous loop:
//   listen → transcribe → STREAM the reply → speak it sentence-by-sentence
//          → auto-reopen the mic → (repeat)
//
// The mic stays LIVE the whole time — including while the agent is speaking —
// so you can just start talking to cut him off (barge-in), exactly like the
// Claude/ChatGPT voice apps. No tapping, no "start speaking" button. A short
// word-count threshold + an echo check (heard text vs. what he's currently
// saying) keep the phone speaker's own bleed from making him interrupt himself.
//
// Two ways to drive it:
//   • Single agent — pass `agentId` + `agentName` + `streamReply` (used by a
//     specific chat page, so the turn also shows in that chat's transcript).
//   • Multi-agent  — pass `voices` (e.g. Reese + Sterling). Defaults to the
//     first, with a one-tap switcher; streams straight to /api/agents/voice-chat
//     for whichever agent is active (used by the global HQ launcher).
//
// STT is pluggable (src/lib/voice/stt.ts — Deepgram swap point); TTS reuses
// /api/agents/tts (ElevenLabs swap point) via the SpeechQueue.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSpeechToText,
  speechRecognitionSupported,
  type SpeechToText,
} from "@/lib/voice/stt";
import { SpeechQueue, createSentenceChunker } from "@/lib/voice/speech-queue";
import { playAgentSpeech, type SpeechHandle } from "@/lib/voice/tts-playback";
import { streamVoiceReply } from "@/lib/voice/voice-client";

type Phase = "listening" | "thinking" | "speaking" | "paused" | "error";

export interface VoiceAgent {
  agentId: string;
  agentName: string;
}

const LABEL: Record<Phase, string> = {
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking",
  paused: "Paused",
  error: "Tap to retry",
};

const RING: Record<Phase, string> = {
  listening: "#00d6ff",
  thinking: "#f59e0b",
  speaking: "#34d399",
  paused: "#6b7280",
  error: "#f87171",
};

// A barge-in has to be at least this many words before we cut the agent off —
// filters out one-syllable echo blips the mic catches from the phone speaker.
const BARGE_IN_MIN_WORDS = 2;

const wordsOf = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);

// True when what the mic just heard is really the agent's own voice bleeding
// back through the speaker (not the user talking). We compare the heard text
// against what the agent is currently saying: heavy word overlap ⇒ it's echo.
function looksLikeEcho(heardText: string, agentIsSaying: string): boolean {
  const heardWords = wordsOf(heardText);
  if (heardWords.length === 0) return true;
  const spoken = new Set(wordsOf(agentIsSaying));
  if (spoken.size === 0) return false;
  const overlap = heardWords.filter((w) => spoken.has(w)).length / heardWords.length;
  return overlap >= 0.6;
}

export default function CarVoiceMode({
  agentId,
  agentName,
  voices,
  streamReply,
  sendMessage,
  onClose,
}: {
  agentId?: string;
  agentName?: string;
  /** Multi-agent mode: land on the first, switch with one tap. */
  voices?: VoiceAgent[];
  /** Single-agent streaming (host chat mirrors the turn into its transcript). */
  streamReply?: (
    text: string,
    handlers: { onDelta: (delta: string) => void }
  ) => Promise<string>;
  /** Single-agent non-streaming fallback. */
  sendMessage?: (text: string) => Promise<string>;
  onClose: () => void;
}) {
  // Roster: explicit `voices`, or a single agent from the props.
  const roster = useMemo<VoiceAgent[]>(
    () => voices ?? (agentId && agentName ? [{ agentId, agentName }] : []),
    [voices, agentId, agentName]
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const active = roster[activeIdx] ?? { agentId: "sterling", agentName: "Sterling" };

  const [phase, setPhaseState] = useState<Phase>("listening");
  const [heard, setHeard] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const activeRef = useRef(true);
  const phaseRef = useRef<Phase>("listening");
  const sttRef = useRef<SpeechToText | null>(null);
  const queueRef = useRef<SpeechQueue | null>(null);
  const speechRef = useRef<SpeechHandle | null>(null);
  // Monotonic turn id — bumped whenever a new user utterance supersedes an
  // in-flight reply (barge-in). The old turn checks this and bails silently.
  const turnRef = useRef(0);
  // The reply text the agent has streamed so far this turn — used to tell real
  // interruptions apart from the agent's own voice echoing back into the mic.
  const spokenTextRef = useRef("");

  // The active agent + its send fn, kept in refs so the loop always uses the
  // current one (even after a mid-session switch) without rebinding STT.
  const agentRef = useRef<VoiceAgent>(active);
  agentRef.current = active;
  // In multi-agent mode we stream straight to the route for the active agent;
  // in single-agent mode we use the host-provided streamReply (transcript-aware).
  const effStreamReply = useMemo(
    () =>
      voices
        ? (text: string, handlers: { onDelta: (delta: string) => void }) =>
            streamVoiceReply(text, { onDelta: handlers.onDelta, agentId: agentRef.current.agentId })
        : streamReply,
    [voices, streamReply]
  );
  const streamRef = useRef(effStreamReply);
  const sendRef = useRef(sendMessage);
  streamRef.current = effStreamReply;
  sendRef.current = sendMessage;

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  // Keep the mic live. Unlike before, this runs in EVERY active phase (not just
  // "listening") so we can hear you interrupt while the agent is speaking. The
  // STT layer no-ops if a recognition is already running, so calling it is safe.
  const startMic = useCallback(() => {
    if (!activeRef.current) return;
    if (phaseRef.current === "paused" || phaseRef.current === "error") return;
    sttRef.current?.start();
  }, []);

  const beginListening = useCallback(() => {
    if (!activeRef.current) return;
    setHeard("");
    setPhase("listening");
    setTimeout(() => startMic(), 150);
  }, [setPhase, startMic]);

  // A new utterance supersedes whatever the agent was mid-reply on: bump the
  // turn id (so the old async turn bails) and cut its audio immediately.
  const stopSpeechRef = useRef<() => void>(() => {});
  const cancelTurn = useCallback(() => {
    turnRef.current += 1;
    stopSpeechRef.current();
  }, []);

  const runStreamingTurn = useCallback(
    async (text: string) => {
      // Claim this turn; any earlier in-flight turn is now stale.
      const myTurn = ++turnRef.current;
      stopSpeechRef.current();
      spokenTextRef.current = "";
      setLastReply("");
      setPhase("thinking");
      // Keep hearing you — the mic stays live through thinking + speaking so you
      // can cut in at any moment.
      startMic();
      const queue = new SpeechQueue(agentRef.current.agentId, {
        onFirstAudio: () => {
          if (activeRef.current && turnRef.current === myTurn && phaseRef.current !== "paused")
            setPhase("speaking");
        },
      });
      queueRef.current = queue;
      const chunker = createSentenceChunker((s) => {
        if (turnRef.current === myTurn) queue.enqueue(s);
      });
      try {
        const full = await streamRef.current!(text, {
          onDelta: (d) => {
            if (!activeRef.current || turnRef.current !== myTurn) return;
            spokenTextRef.current += d;
            chunker.push(d);
          },
        });
        if (turnRef.current !== myTurn) {
          queue.stop();
          return; // superseded by a barge-in mid-generation
        }
        setLastReply(full);
        chunker.flush();
        queue.end();
        await queue.drained();
      } catch (err) {
        queue.stop();
        if (activeRef.current && turnRef.current === myTurn) {
          const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
          setErrorMsg(`Couldn't reach ${agentRef.current.agentName}${detail} — tap to retry.`);
          setPhase("error");
        }
        return;
      }
      // Superseded while draining, or session ended → don't touch the UI.
      if (!activeRef.current || turnRef.current !== myTurn) return;
      setHeard("");
      setPhase("listening");
      startMic();
    },
    [setPhase, startMic]
  );

  const runBufferedTurn = useCallback(
    async (text: string) => {
      const myTurn = ++turnRef.current;
      stopSpeechRef.current();
      spokenTextRef.current = "";
      setPhase("thinking");
      startMic();
      try {
        const reply = await sendRef.current!(text);
        if (!activeRef.current || turnRef.current !== myTurn) return;
        spokenTextRef.current = reply;
        setLastReply(reply);
        setPhase("speaking");
        const handle = playAgentSpeech(agentRef.current.agentId, reply, {
          onStart: () => {
            if (activeRef.current && turnRef.current === myTurn && phaseRef.current !== "paused")
              setPhase("speaking");
          },
        });
        speechRef.current = handle;
        await handle.done;
        speechRef.current = null;
        if (!activeRef.current || turnRef.current !== myTurn) return;
        setHeard("");
        setPhase("listening");
        startMic();
      } catch {
        if (activeRef.current && turnRef.current === myTurn) {
          setErrorMsg(`Couldn't reach ${agentRef.current.agentName} — tap to try again.`);
          setPhase("error");
        }
      }
    },
    [setPhase, startMic]
  );

  const handleFinal = useCallback(
    async (text: string) => {
      if (!activeRef.current) return;
      const t = text.trim();
      if (!t) return;
      // If the agent is still talking and this "final" is really his own voice
      // echoing back through the speaker, drop it — don't start a phantom turn.
      const p = phaseRef.current;
      if ((p === "speaking" || p === "thinking") && looksLikeEcho(t, spokenTextRef.current)) return;
      setLastTranscript(t);
      setHeard("");
      if (streamRef.current) await runStreamingTurn(t);
      else if (sendRef.current) await runBufferedTurn(t);
    },
    [runStreamingTurn, runBufferedTurn]
  );

  useEffect(() => {
    activeRef.current = true;
    if (!speechRecognitionSupported()) {
      setErrorMsg(
        "This browser can't do voice input. Chrome or Safari on your phone works best — for now, type your message."
      );
      setPhase("error");
      return;
    }
    const stt = createSpeechToText({
      onPartial: (t) => {
        if (!activeRef.current) return;
        const p = phaseRef.current;
        if (p === "listening") {
          setHeard(t);
          return;
        }
        // Barge-in: you started talking while the agent was thinking/speaking.
        if (p === "speaking" || p === "thinking") {
          if (wordsOf(t).length < BARGE_IN_MIN_WORDS) return; // too short — likely echo
          if (looksLikeEcho(t, spokenTextRef.current)) return; // it's his own voice
          cancelTurn(); // cut him off now; the mic's final drives the next turn
          setHeard(t);
          setPhase("listening");
        }
      },
      onFinal: (t) => void handleFinal(t),
      onEnd: () => {
        if (!activeRef.current) return;
        if (phaseRef.current === "paused" || phaseRef.current === "error") return;
        // Mic keeps itself alive across every active phase so barge-in always works.
        setTimeout(() => startMic(), 250);
      },
      onError: (e) => {
        if (!activeRef.current) return;
        const denied = e.code === "not-allowed" || e.code === "service-not-allowed";
        setErrorMsg(
          denied
            ? "Microphone access is blocked. Allow the mic for this site, then tap to retry."
            : "The mic dropped. Tap the circle to start listening again."
        );
        setPhase("error");
      },
    });
    sttRef.current = stt;
    beginListening();

    // Keep the phone screen awake for the whole conversation (Android/Chrome)
    // so it doesn't sleep mid-sentence. The lock is auto-released when the tab
    // is hidden, so re-acquire when it becomes visible again.
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    let wakeLock: { release: () => Promise<void> } | null = null;
    const acquireWakeLock = async () => {
      if (!nav.wakeLock || !activeRef.current || document.visibilityState !== "visible") return;
      try {
        wakeLock = await nav.wakeLock.request("screen");
      } catch {
        /* denied / unsupported — fall back to normal screen timeout */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquireWakeLock();
    };
    void acquireWakeLock();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      activeRef.current = false;
      stt.abort();
      queueRef.current?.stop();
      speechRef.current?.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      wakeLock?.release().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopSpeech = useCallback(() => {
    queueRef.current?.stop();
    queueRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
  }, []);
  // Let cancelTurn (defined earlier) reach the real stopSpeech.
  stopSpeechRef.current = stopSpeech;

  const onMainTap = useCallback(() => {
    if (!activeRef.current) return;
    switch (phaseRef.current) {
      case "speaking":
        // Manual interrupt (barge-in also does this automatically now).
        cancelTurn();
        beginListening();
        break;
      case "listening":
        sttRef.current?.abort();
        setPhase("paused");
        break;
      case "paused":
      case "error":
        beginListening();
        break;
      case "thinking":
        break;
    }
  }, [beginListening, setPhase, cancelTurn]);

  // Switch agents mid-session: cut any speech, stop the mic, rebind, listen.
  const switchTo = useCallback(
    (idx: number) => {
      if (idx === activeIdx) return;
      cancelTurn();
      sttRef.current?.abort();
      setActiveIdx(idx);
      setLastTranscript("");
      setLastReply("");
      beginListening();
    },
    [activeIdx, beginListening, cancelTurn]
  );

  const endSession = useCallback(() => {
    activeRef.current = false;
    sttRef.current?.abort();
    stopSpeech();
    onClose();
  }, [onClose, stopSpeech]);

  const ring = RING[phase];
  const pulsing = phase === "listening" || phase === "speaking";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#050608] px-6 py-8 text-center">
      <div className="flex w-full items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-widest text-gray-500">
          Voice · {active.agentName}
        </span>
        <button
          onClick={endSession}
          className="rounded-full border border-gray-700 px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200"
        >
          End
        </button>
      </div>

      {/* Agent switcher (multi-agent mode) — Reese default, Sterling a tap away. */}
      {roster.length > 1 && (
        <div className="mt-2 flex items-center gap-2">
          {roster.map((v, i) => (
            <button
              key={v.agentId}
              onClick={() => switchTo(i)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                i === activeIdx
                  ? "border-[#00d6ff] bg-[#00d6ff]/15 text-[#00d6ff]"
                  : "border-gray-700 text-gray-400 hover:text-gray-200"
              }`}
            >
              {v.agentName}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <button
          onClick={onMainTap}
          aria-label={LABEL[phase]}
          className="relative flex items-center justify-center rounded-full transition-transform active:scale-95"
          style={{
            width: "min(62vw, 300px)",
            height: "min(62vw, 300px)",
            background: `radial-gradient(circle at 50% 40%, ${ring}22, #0a0c0f 70%)`,
            border: `4px solid ${ring}`,
            boxShadow: pulsing ? `0 0 60px ${ring}55` : "none",
          }}
        >
          {pulsing && (
            <span
              className="absolute inset-0 rounded-full"
              style={{ border: `2px solid ${ring}`, animation: "voicePulse 1.6s ease-out infinite" }}
            />
          )}
          <span className="px-6 text-2xl font-semibold text-white">{LABEL[phase]}</span>
        </button>

        <div className="min-h-[3.5rem] max-w-xl">
          {phase === "listening" && heard && <p className="text-lg text-gray-300">{heard}</p>}
          {phase === "thinking" && lastTranscript && (
            <p className="text-lg text-gray-400">“{lastTranscript}”</p>
          )}
          {phase === "error" && <p className="text-lg text-red-300">{errorMsg}</p>}
          {phase === "paused" && (
            <p className="text-lg text-gray-500">Tap the circle to start listening.</p>
          )}
        </div>
      </div>

      <div className="flex w-full flex-col items-center gap-5">
        {lastReply && phase === "speaking" && (
          <p className="line-clamp-2 max-w-xl text-sm text-gray-500">{lastReply}</p>
        )}
        <button
          onClick={endSession}
          className="w-full max-w-md rounded-2xl bg-red-600/90 py-5 text-xl font-semibold text-white transition-colors hover:bg-red-600 active:scale-[0.99]"
        >
          End conversation
        </button>
        <p className="text-xs text-gray-600">
          {phase === "speaking"
            ? `Just start talking to cut in · saved to your ${active.agentName} chat`
            : `Tap the circle to ${phase === "listening" ? "pause" : "listen"} · saved to your ${active.agentName} chat`}
        </p>
      </div>
    </div>
  );
}
