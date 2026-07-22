// ---------------------------------------------------------------------------
// tts-playback.ts — play an agent's reply out loud, on the client.
//
// Points at the EXISTING /api/agents/tts streaming route, which already picks
// the best provider server-side (ElevenLabs → Gemini → 501). So the provider
// swap for the *voice* lives in that route, not here — this file just plays the
// audio and, if the server has no key (501/any error), falls back to the
// browser's built-in speech synthesis so Voice Mode still talks.
//
//   Provider swap for TTS  →  src/app/api/agents/tts/route.ts  (ElevenLabs is
//   already the top of the ladder when ELEVENLABS_API_KEY is set).
// ---------------------------------------------------------------------------
import { speakableText } from "./speakable";

export interface SpeechHandle {
  /** Resolves when playback finishes (server audio OR browser fallback). */
  done: Promise<void>;
  /** Stop immediately (used for barge-in / ending the session). */
  stop(): void;
}

function pickBrowserVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  if (!voices.length) return null;
  const prefer = ["Natural", "Google US English", "Samantha", "Aria", "Zira"];
  for (const hint of prefer) {
    const hit = voices.find((v) => v.name.includes(hint));
    if (hit) return hit;
  }
  return voices.find((v) => v.default) ?? voices[0];
}

/**
 * Speak `text` as `agentId`. Cleans the text for the ear, plays the server
 * voice, and falls back to the browser voice on any failure. `onStart` fires
 * the moment audio actually begins (so the UI can flip to "speaking").
 */
export function playAgentSpeech(
  agentId: string,
  text: string,
  opts: { rate?: number; onStart?: () => void } = {}
): SpeechHandle {
  const clean = speakableText(text);
  const rate = opts.rate ?? 1.0;

  let stopped = false;
  let audio: HTMLAudioElement | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const finish = () => {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
    resolveDone();
  };

  const stop = () => {
    stopped = true;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    if (audio) {
      audio.pause();
      audio = null;
    }
    finish();
  };

  if (!clean) {
    // Nothing to say — resolve on next tick so callers can await uniformly.
    Promise.resolve().then(finish);
    return { done, stop };
  }

  const speakWithBrowser = () => {
    if (stopped) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      finish();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = pickBrowserVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    let started = false;
    utterance.onstart = () => {
      started = true;
      opts.onStart?.();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
    if (!started) opts.onStart?.(); // some browsers never fire onstart
    // Chrome silences long utterances after ~15s; a periodic resume() keeps it going.
    keepalive = setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
      else if (keepalive) {
        clearInterval(keepalive);
        keepalive = null;
      }
    }, 10_000);
  };

  // Preferred path: the server voice, streamed.
  const url = `/api/agents/tts?agentId=${encodeURIComponent(agentId)}&text=${encodeURIComponent(clean)}`;
  audio = new Audio(url);
  audio.playbackRate = rate;
  if ("preservesPitch" in audio) {
    (audio as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
  }
  audio.onplaying = () => opts.onStart?.();
  audio.onended = finish;
  audio.onerror = () => {
    if (!stopped) speakWithBrowser();
  };
  audio.play().catch(() => {
    if (!stopped) speakWithBrowser();
  });

  return { done, stop };
}
