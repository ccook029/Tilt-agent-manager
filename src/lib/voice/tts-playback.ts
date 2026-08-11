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

/**
 * A clip that is already downloading but hasn't been played yet.
 *
 * This is the whole point of the split: synthesising a sentence costs a network
 * round-trip plus provider time, and if that only starts when the previous
 * sentence FINISHES, the listener hears a silent gap at every sentence
 * boundary — speech that starts, cuts out, and stutters on. Preparing the next
 * clip while the current one plays hides that latency behind the audio.
 */
export interface PreparedSpeech {
  /** Start playing the clip that's already buffering. */
  play(opts?: { onStart?: () => void }): SpeechHandle;
  /** Throw it away without playing (barge-in before we got to it). */
  discard(): void;
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
 * Start fetching the audio for `text` now, to be played later.
 *
 * The element is created and `load()`ed immediately, so by the time the caller
 * plays it the clip is usually buffered and starts instantly. `preferBrowser`
 * skips the server entirely — used once a reply has already fallen back, so a
 * single failed sentence doesn't make the agent swap voices mid-answer.
 */
export function prepareAgentSpeech(
  agentId: string,
  text: string,
  opts: { rate?: number; preferBrowser?: boolean; onFallback?: () => void } = {}
): PreparedSpeech {
  const clean = speakableText(text);
  const rate = opts.rate ?? 1.0;

  let stopped = false;
  let audio: HTMLAudioElement | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  // Warm the clip now — this is the prefetch.
  if (clean && !opts.preferBrowser) {
    audio = new Audio();
    audio.preload = "auto";
    audio.src = `/api/agents/tts?agentId=${encodeURIComponent(agentId)}&text=${encodeURIComponent(clean)}`;
    audio.playbackRate = rate;
    if ("preservesPitch" in audio) {
      (audio as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
    }
    audio.load();
  }

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

  const speakWithBrowser = (onStart?: () => void) => {
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
      onStart?.();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
    if (!started) onStart?.(); // some browsers never fire onstart
    // Chrome silences long utterances after ~15s; a periodic resume() keeps it going.
    keepalive = setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
      else if (keepalive) {
        clearInterval(keepalive);
        keepalive = null;
      }
    }, 10_000);
  };

  const play = (playOpts: { onStart?: () => void } = {}): SpeechHandle => {
    if (!clean) {
      // Nothing to say — resolve on next tick so callers can await uniformly.
      Promise.resolve().then(finish);
      return { done, stop };
    }
    if (!audio) {
      speakWithBrowser(playOpts.onStart);
      return { done, stop };
    }

    const toBrowser = () => {
      if (stopped) return;
      audio = null;
      opts.onFallback?.();
      speakWithBrowser(playOpts.onStart);
    };

    audio.onplaying = () => playOpts.onStart?.();
    audio.onended = finish;
    audio.onerror = toBrowser;
    audio.play().catch(toBrowser);
    return { done, stop };
  };

  return {
    play,
    discard: () => {
      stopped = true;
      if (audio) {
        audio.pause();
        audio.src = "";
        audio = null;
      }
    },
  };
}

/**
 * Speak `text` as `agentId` right now — prepare and play in one step. Used for
 * one-off playback (the Listen button); the voice queue prepares ahead instead.
 */
export function playAgentSpeech(
  agentId: string,
  text: string,
  opts: { rate?: number; onStart?: () => void } = {}
): SpeechHandle {
  return prepareAgentSpeech(agentId, text, { rate: opts.rate }).play({
    onStart: opts.onStart,
  });
}
