"use client";

// ---------------------------------------------------------------------------
// CarVoiceMode — hands-free, tap-once voice conversation overlay.
//
// Full-screen, high-contrast, built for a phone in a car dock: one giant
// button, big status text, minimal reading. It drives a continuous loop —
//
//     listen → transcribe → send to the SAME chat backend → speak the reply
//            → auto-reopen the mic → (repeat)
//
// It never talks to Claude directly: it calls the `sendMessage(text)` the host
// chat already uses, so the system prompt, business context, and KV transcript
// are identical to typing. STT is pluggable (src/lib/voice/stt.ts — Deepgram
// swap point); TTS reuses /api/agents/tts (ElevenLabs swap point) via
// playAgentSpeech.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSpeechToText,
  speechRecognitionSupported,
  type SpeechToText,
} from "@/lib/voice/stt";
import { playAgentSpeech, type SpeechHandle } from "@/lib/voice/tts-playback";

type Phase = "listening" | "thinking" | "speaking" | "paused" | "error";

const LABEL: Record<Phase, string> = {
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking",
  paused: "Paused",
  error: "Tap to retry",
};

// Ring color per phase (Tilt cyan / amber / green / gray / red).
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
  sendMessage,
  onClose,
}: {
  agentId: string;
  agentName: string;
  /** The host chat's send — posts to the same route, returns the reply text. */
  sendMessage: (text: string) => Promise<string>;
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
  const speechRef = useRef<SpeechHandle | null>(null);
  // Keep the latest sendMessage without re-binding the STT engine.
  const sendRef = useRef(sendMessage);
  sendRef.current = sendMessage;

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const beginListening = useCallback(() => {
    if (!activeRef.current) return;
    setHeard("");
    setPhase("listening");
    // Small delay lets a just-ended recognition instance reset cleanly.
    setTimeout(() => {
      if (activeRef.current && phaseRef.current === "listening") sttRef.current?.start();
    }, 150);
  }, [setPhase]);

  const speakReply = useCallback(
    async (reply: string) => {
      if (!activeRef.current) return;
      setLastReply(reply);
      setPhase("speaking");
      const handle = playAgentSpeech(agentId, reply, {
        rate: 1.0,
        onStart: () => {
          if (activeRef.current && phaseRef.current !== "paused") setPhase("speaking");
        },
      });
      speechRef.current = handle;
      await handle.done;
      speechRef.current = null;
      if (!activeRef.current) return;
      // Auto-reopen the mic so the conversation continues with no tap.
      beginListening();
    },
    [agentId, beginListening, setPhase]
  );

  const handleFinal = useCallback(
    async (text: string) => {
      if (!activeRef.current) return;
      const t = text.trim();
      if (!t) return; // silence → onEnd will keep the mic open
      setLastTranscript(t);
      setHeard("");
      setPhase("thinking");
      try {
        const reply = await sendRef.current(t);
        if (!activeRef.current) return;
        await speakReply(reply);
      } catch {
        if (!activeRef.current) return;
        setErrorMsg(`Couldn't reach ${agentName} — tap to try again.`);
        setPhase("error");
      }
    },
    [agentName, speakReply, setPhase]
  );

  // Build the STT engine once, on mount.
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
        // Recognition stopped on its own. If we're still meant to be listening
        // (a silent stretch, no phrase captured), reopen the mic.
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
      speechRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The big button: barge-in / pause / resume / retry depending on phase.
  const onMainTap = useCallback(() => {
    if (!activeRef.current) return;
    switch (phaseRef.current) {
      case "speaking":
        // Barge-in: cut off the reply and start listening right away.
        speechRef.current?.stop();
        speechRef.current = null;
        beginListening();
        break;
      case "listening":
        // Pause listening.
        sttRef.current?.abort();
        setPhase("paused");
        break;
      case "paused":
      case "error":
        beginListening();
        break;
      case "thinking":
        // Busy — ignore taps while the model is working.
        break;
    }
  }, [beginListening, setPhase]);

  const endSession = useCallback(() => {
    activeRef.current = false;
    sttRef.current?.abort();
    speechRef.current?.stop();
    onClose();
  }, [onClose]);

  const ring = RING[phase];
  const pulsing = phase === "listening" || phase === "speaking";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#050608] px-6 py-10 text-center">
      {/* Top: who you're talking to + a text End (belt-and-suspenders). */}
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

      {/* Middle: the one giant button. */}
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

        {/* Live captions — big enough to catch at a glance, not to read. */}
        <div className="min-h-[3.5rem] max-w-xl">
          {phase === "listening" && heard && (
            <p className="text-lg text-gray-300">{heard}</p>
          )}
          {phase === "thinking" && lastTranscript && (
            <p className="text-lg text-gray-400">“{lastTranscript}”</p>
          )}
          {phase === "error" && <p className="text-lg text-red-300">{errorMsg}</p>}
          {phase === "paused" && (
            <p className="text-lg text-gray-500">Tap the circle to start listening.</p>
          )}
        </div>
      </div>

      {/* Bottom: last thing said (small), and the primary End button. */}
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
          Tap the circle to {phase === "speaking" ? "interrupt" : phase === "listening" ? "pause" : "listen"} · saved to your {agentName} chat
        </p>
      </div>
    </div>
  );
}
