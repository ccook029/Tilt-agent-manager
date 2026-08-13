// ---------------------------------------------------------------------------
// tts-playback.ts — play an agent's reply out loud, on the client.
//
// Points at the EXISTING /api/agents/tts streaming route, which already picks
// the best provider server-side (ElevenLabs → Gemini → 501). So the provider
// swap for the *voice* lives in that route, not here — this file just fetches
// the audio and, if the server genuinely has no voice, falls back to the
// browser's built-in speech synthesis so Voice Mode still talks.
//
//   Provider swap for TTS  →  src/app/api/agents/tts/route.ts  (ElevenLabs is
//   already the top of the ladder when ELEVENLABS_API_KEY is set).
//
// Why this file fetches instead of pointing <audio src> at the route
// ---------------------------------------------------------------------------
// It used to do the simple thing: `new Audio(url)` and let the element stream.
// Two problems, and together they were the whole "he goes choppy after the
// first line" bug.
//
//  1. A streaming <audio> holds its HTTP request open for as long as the clip
//     plays, and that request is holding an ElevenLabs connection open too. A
//     reply is several clips, prepared ahead — so three ElevenLabs requests
//     could be live at once. Every plan caps concurrent requests (2 on the
//     free tier), so the second and third came back 429.
//
//  2. `audio.onerror` can't tell you WHY. A 429 and a "no API key configured"
//     look identical, so a transient concurrency cap was read as "the server
//     has no voice", the reply latched to the browser voice, and everything
//     after the opener came out of the phone's robot synthesiser. Which is
//     exactly what "the first line is good, then it's choppy" sounds like.
//
// So: fetch the clip, read the status code, retry the transient ones, and only
// give up on the server voice when the server actually says it hasn't got one.
// The connection closes as soon as the bytes land, so preparing ahead no longer
// stacks up open requests.
// ---------------------------------------------------------------------------
import { speakableText } from "./speakable";

export interface SpeechHandle {
  /** Resolves when playback finishes (server audio OR browser fallback). */
  done: Promise<void>;
  /** Stop immediately (used for barge-in / ending the session). */
  stop(): void;
}

/** Which voice a clip actually came out in — surfaced so a fallback is visible
 *  on screen instead of being something you have to diagnose by ear. */
export type SpeechSource = "server" | "browser";

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

export interface PrepareOpts {
  rate?: number;
  /** Skip the server entirely — set once a reply has definitively lost it. */
  preferBrowser?: boolean;
  /**
   * The server voice couldn't be used for this clip. `permanent` means the
   * server told us it has no voice at all (501 / no key), so the rest of the
   * reply should stop asking. A transient failure (429, 5xx, a dropped
   * connection) reports `false` — this clip falls back, the next one tries
   * again, and the reply doesn't lose the agent's voice over one bad request.
   */
  onFallback?: (permanent: boolean) => void;
  /** Fired once we know which voice this clip is actually playing in. */
  onSource?: (source: SpeechSource) => void;
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

type ClipResult =
  | { ok: true; blob: Blob }
  /** `permanent` ⇒ don't bother asking the server again this reply. */
  | { ok: false; permanent: boolean };

/** One retry is enough: the failure we're covering is a concurrency cap that
 *  clears the moment the clip ahead finishes downloading. */
const RETRIES = 1;
const RETRY_DELAY_MS = 400;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchClip(url: string, signal: AbortSignal): Promise<ClipResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (res.ok) return { ok: true, blob: await res.blob() };
      // 501 is the route saying no provider key is configured. Nothing to
      // retry, and every other clip in this reply will get the same answer.
      if (res.status === 501) return { ok: false, permanent: true };
      // 429 (provider concurrency cap) and 5xx are transient. Treating these
      // as permanent is what dropped whole replies into the browser voice.
      if (attempt >= RETRIES) return { ok: false, permanent: false };
    } catch {
      if (signal.aborted) return { ok: false, permanent: true };
      if (attempt >= RETRIES) return { ok: false, permanent: false };
    }
    await wait(RETRY_DELAY_MS);
    if (signal.aborted) return { ok: false, permanent: true };
  }
}

/**
 * Start fetching the audio for `text` now, to be played later.
 *
 * The fetch is kicked off immediately, so by the time the caller plays it the
 * clip is usually in memory and starts instantly. `preferBrowser` skips the
 * server entirely — used once a reply has definitively lost the server voice,
 * so it doesn't spend a round-trip per sentence rediscovering that.
 */
export function prepareAgentSpeech(
  agentId: string,
  text: string,
  opts: PrepareOpts = {}
): PreparedSpeech {
  const clean = speakableText(text);
  const rate = opts.rate ?? 1.0;

  let stopped = false;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  // Warm the clip now — this is the prefetch. It resolves to bytes or to a
  // classified failure; nothing plays until play() is called.
  const controller = new AbortController();
  const clip =
    clean && !opts.preferBrowser
      ? fetchClip(
          `/api/agents/tts?agentId=${encodeURIComponent(agentId)}&text=${encodeURIComponent(clean)}`,
          controller.signal
        )
      : null;

  const release = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const finish = () => {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
    release();
    resolveDone();
  };

  const stop = () => {
    stopped = true;
    controller.abort();
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
    opts.onSource?.("browser");
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
    if (!clip) {
      speakWithBrowser(playOpts.onStart);
      return { done, stop };
    }

    void (async () => {
      const result = await clip;
      if (stopped) return;

      if (!result.ok) {
        opts.onFallback?.(result.permanent);
        speakWithBrowser(playOpts.onStart);
        return;
      }

      opts.onSource?.("server");
      objectUrl = URL.createObjectURL(result.blob);
      const el = new Audio(objectUrl);
      el.playbackRate = rate;
      // Keep the pitch natural if sped up (default in modern browsers, set
      // explicitly where supported).
      if ("preservesPitch" in el) {
        (el as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
      }
      // The bytes are already here, so a playback failure now is a decode or
      // autoplay problem, not a provider one — this clip falls back, the reply
      // keeps its voice.
      const toBrowser = () => {
        if (stopped) return;
        audio = null;
        release();
        opts.onFallback?.(false);
        speakWithBrowser(playOpts.onStart);
      };
      el.onplaying = () => playOpts.onStart?.();
      el.onended = finish;
      el.onerror = toBrowser;
      audio = el;
      el.play().catch(toBrowser);
    })();

    return { done, stop };
  };

  return {
    play,
    discard: () => {
      stopped = true;
      controller.abort();
      if (audio) {
        audio.pause();
        audio = null;
      }
      release();
      // Resolve too: a discarded clip's `done` was left hanging forever, so
      // anything awaiting it (the queue's drain) would never settle.
      resolveDone();
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
