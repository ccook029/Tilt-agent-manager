"use client";

// ---------------------------------------------------------------------------
// CarVoiceMode — hands-free, real-time voice conversation overlay.
//
// Full-screen, high-contrast, one giant button. It runs a continuous loop —
//
//     listen → transcribe → STREAM the reply → speak it sentence-by-sentence
//            (starts talking while the rest is still being written)
//            → auto-reopen the mic → (repeat)
//
// It never calls Claude directly: it calls the host's `streamReply(text,…)`,
// which hits the same CFO backend and KV transcript as typing — only faster
// and streamed. STT is pluggable (src/lib/voice/stt.ts — Deepgram swap point);
// TTS reuses /api/agents/tts (ElevenLabs swap point) via the SpeechQueue.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSpeechToText,
  speechRecognitionSupported,
  type SpeechToText,
} from "@/lib/voice/stt";
import { SpeechQueue, createSentenceChunker } from "@/lib/voice/speech-queue";
import { playAgentSpeech, type SpeechHandle } from "@/lib/voice/tts-playback";

type Phase = "listening" | "thinking" | "speaking" | "paused" | "error";

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

export default function CarVoiceMode({
  agentId,
  agentName,
  streamReply,
  sendMessage,
  onClose,
}: {
  agentId: string;
  agentName: string;
  /** Preferred: streams the reply so speech starts before it's fully written. */
  streamReply?: (
    text: string,
    handlers: { onDelta: (delta: string) => void }
  ) => Promise<string>;
  /** Fallback: non-streaming send that returns the whole reply. */
  sendMessage?: (text: string) => Promise<string>;
  onClose: () => void;
}) {
  const [phase, setPhaseState] = useState<Phase>("listening");
  const [heard, setHeard] = useState(""); // live interim transcript
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const activeRef = useRef(true);
  const phaseRef = useRef<Phase>("listening");
  const sttRef = useRef<SpeechToText | null>(null);
  const queueRef = useRef<SpeechQueue | null>(null); // streaming TTS
  const speechRef = useRef<SpeechHandle | null>(null); // non-streaming fallback
  const streamRef = useRef(streamReply);
  const sendRef = useRef(sendMessage);
  streamRef.current = streamReply;
  sendRef.current = sendMessage;

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const beginListening = useCallback(() => {
    if (!activeRef.current) return;
    setHeard("");
    setPhase("listening");
    setTimeout(() => {
      if (activeRef.current && phaseRef.current === "listening") sttRef.current?.start();
    }, 150);
  }, [setPhase]);

  // Streamed turn: pipe deltas → sentence chunker → speech queue, so Sterling
  // starts talking on the first sentence and the mic reopens when he's done.
  const runStreamingTurn = useCallback(
    async (text: string) => {
      setLastReply("");
      setPhase("thinking");
      const queue = new SpeechQueue(agentId, {
        onFirstAudio: () => {
          if (activeRef.current && phaseRef.current !== "paused") setPhase("speaking");
        },
      });
      queueRef.current = queue;
      const chunker = createSentenceChunker((s) => queue.enqueue(s));
      try {
        const full = await streamRef.current!(text, {
          onDelta: (d) => {
            if (activeRef.current) chunker.push(d);
          },
        });
        setLastReply(full);
        chunker.flush();
        queue.end();
        await queue.drained();
      } catch {
        queue.stop();
        if (activeRef.current) {
          setErrorMsg(`Couldn't reach ${agentName} — tap to try again.`);
          setPhase("error");
        }
        return;
      }
      if (!activeRef.current) return;
      beginListening();
    },
    [agentId, agentName, beginListening, setPhase]
  );

  // Fallback turn: wait for the whole reply, then speak it.
  const runBufferedTurn = useCallback(
    async (text: string) => {
      setPhase("thinking");
      try {
        const reply = await sendRef.current!(text);
        if (!activeRef.current) return;
        setLastReply(reply);
        setPhase("speaking");
        const handle = playAgentSpeech(agentId, reply, {
          onStart: () => {
            if (activeRef.current && phaseRef.current !== "paused") setPhase("speaking");
          },
        });
        speechRef.current = handle;
        await handle.done;
        speechRef.current = null;
        if (activeRef.current) beginListening();
      } catch {
        if (activeRef.current) {
          setErrorMsg(`Couldn't reach ${agentName} — tap to try again.`);
          setPhase("error");
        }
      }
    },
    [agentId, agentName, beginListening, setPhase]
  );

  const handleFinal = useCallback(
    async (text: string) => {
      if (!activeRef.current) return;
      const t = text.trim();
      if (!t) return; // silence → onEnd keeps the mic open
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
        if (activeRef.current && phaseRef.current === "listening") setHeard(t);
      },
      onFinal: (t) => void handleFinal(t),
      onEnd: () => {
        if (activeRef.current && phaseRef.current === "listening") {
          setTimeout(() => {
            if (activeRef.current && phaseRef.current === "listening") sttRef.current?.start();
          }, 250);
        }
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

    return () => {
      activeRef.current = false;
      stt.abort();
      queueRef.current?.stop();
      speechRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopSpeech = useCallback(() => {
    queueRef.current?.stop();
    queueRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
  }, []);

  const onMainTap = useCallback(() => {
    if (!activeRef.current) return;
    switch (phaseRef.current) {
      case "speaking":
        stopSpeech(); // barge-in
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
        break; // busy
    }
  }, [beginListening, setPhase, stopSpeech]);

  const endSession = useCallback(() => {
    activeRef.current = false;
    sttRef.current?.abort();
    stopSpeech();
    onClose();
  }, [onClose, stopSpeech]);

  const ring = RING[phase];
  const pulsing = phase === "listening" || phase === "speaking";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#050608] px-6 py-10 text-center">
      <div className="flex w-full items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-widest text-gray-500">
          Voice · {agentName}
        </span>
        <button
          onClick={endSession}
          className="rounded-full border border-gray-700 px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200"
        >
          End
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <button
          onClick={onMainTap}
          aria-label={LABEL[phase]}
          className="relative flex items-center justify-center rounded-full transition-transform active:scale-95"
          style={{
            width: "min(64vw, 320px)",
            height: "min(64vw, 320px)",
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
          Tap the circle to{" "}
          {phase === "speaking" ? "interrupt" : phase === "listening" ? "pause" : "listen"} · saved
          to your {agentName} chat
        </p>
      </div>
    </div>
  );
}
