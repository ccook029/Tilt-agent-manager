// ---------------------------------------------------------------------------
// stt.ts — speech-to-text for hands-free Voice Mode.
//
// One small provider interface (SpeechToText) so the rest of the app never
// touches a specific engine. Today it's the browser's built-in Web Speech API
// (zero latency to set up, no key, works offline-ish). To move to Deepgram
// later, implement `createDeepgramStt` below and flip the default in
// `createSpeechToText` — NOTHING ELSE in the app changes.
//
//   ┌─────────────────────────  SWAP POINT  ─────────────────────────┐
//   │ createSpeechToText(provider) → returns a SpeechToText           │
//   │   "browser"  → Web Speech API           (default, wired now)    │
//   │   "deepgram" → Deepgram streaming WS     (stub — see below)     │
//   └────────────────────────────────────────────────────────────────┘
// ---------------------------------------------------------------------------

export type SttProvider = "browser" | "deepgram";

export interface SttHandlers {
  /** Live interim words as the user is still talking (for on-screen feedback). */
  onPartial?: (text: string) => void;
  /** A completed utterance (a phrase, ended by a natural pause). */
  onFinal: (text: string) => void;
  /** Recognition ended on its own (pause/timeout) — the loop decides what next. */
  onEnd?: () => void;
  /** A real error (mic denied, network, not-supported). `code` is stable. */
  onError: (err: { code: string; message: string }) => void;
}

export interface SpeechToText {
  /** Begin listening. Safe to call again after it has ended. */
  start(): void;
  /** Stop listening but let any final result flush (fires onFinal then onEnd). */
  stop(): void;
  /** Hard stop — no final result, no onEnd. Used when the user ends the session. */
  abort(): void;
  /** Whether this engine can run in the current browser. */
  readonly supported: boolean;
  /**
   * Whether a recognition is live right now. The loop reads this to keep an
   * existing mic session alive without constructing a new one — building a new
   * recognizer grabs the microphone, and a mic grab stutters audio that's
   * already playing out of the speaker.
   */
  readonly running: boolean;
}

// --- Minimal Web Speech typings (not in the standard DOM lib) --------------
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getBrowserRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---------------------------------------------------------------------------
// Browser Web Speech implementation.
//
// One phrase at a time (continuous:false) so the engine auto-stops on a
// natural pause — that pause IS the turn boundary in a back-and-forth. The
// Voice Mode loop restarts it after the agent finishes speaking.
// ---------------------------------------------------------------------------
function createBrowserStt(opts: { lang?: string; continuous?: boolean }): SpeechToText {
  const Ctor = getBrowserRecognitionCtor();
  let rec: SpeechRecognitionLike | null = null;
  let handlers: SttHandlers | null = null;
  // Tracks whether we intentionally aborted, so onend stays silent then.
  let aborted = false;
  // Whether a recognition is currently live. Guards the always-on mic loop from
  // spawning a second recognition (which would double-capture audio) if start()
  // is called while one is already running. Kept accurate via onstart/onend so a
  // watchdog can safely re-call start() to self-heal a silently-dead recognizer.
  let running = false;

  const impl: SpeechToText & { _bind(h: SttHandlers): void } = {
    supported: Boolean(Ctor),
    get running() {
      return running;
    },
    _bind(h: SttHandlers) {
      handlers = h;
    },
    start() {
      if (!Ctor || !handlers) {
        handlers?.onError({ code: "unsupported", message: "Speech recognition isn't available in this browser." });
        return;
      }
      if (running) return; // already listening — don't stack a second recognition
      aborted = false;
      // Cut the previous recognizer loose before replacing it. Without this,
      // a start() that threw (or a recognizer that reported `onend` but hadn't
      // actually released the mic) left a live object nobody held a reference
      // to any more — abort() and stop() only ever reach the newest one. Each
      // orphan keeps its grip on the microphone, and on a phone every extra
      // mic grab re-negotiates the audio session and audibly chops whatever is
      // playing through the speaker.
      if (rec) {
        const orphan = rec;
        orphan.onresult = null;
        orphan.onerror = null;
        orphan.onend = null;
        orphan.onstart = null;
        try {
          orphan.abort();
        } catch {
          /* already dead */
        }
      }
      // One long-lived recognition (continuous) is far more reliable than
      // stop/restart per phrase: Chrome's start() throws if the prior session
      // hasn't released yet, which used to strand us on "Listening…" with a dead
      // mic. In continuous mode we let it run and emit a final per pause.
      rec = new Ctor();
      rec.lang = opts.lang ?? "en-US";
      rec.continuous = opts.continuous ?? false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        running = true;
      };
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const chunk = result[0]?.transcript ?? "";
          if (result.isFinal) {
            // Emit each completed phrase immediately — snappier, and it works
            // whether or not the recognizer ever ends (it doesn't, in continuous
            // mode). onEnd is now purely a "recognizer died, restart me" signal.
            const finalChunk = chunk.trim();
            if (finalChunk) handlers?.onFinal(finalChunk);
          } else {
            interim += chunk;
          }
        }
        if (interim) handlers?.onPartial?.(interim.trim());
      };
      rec.onerror = (e) => {
        // "no-speech"/"aborted" are normal loop events, not failures to surface.
        if (e.error === "no-speech" || e.error === "aborted") return;
        handlers?.onError({ code: e.error || "error", message: e.message || e.error || "Speech recognition error." });
      };
      rec.onend = () => {
        running = false;
        if (aborted) return;
        handlers?.onEnd?.();
      };
      try {
        rec.start();
        running = true;
      } catch {
        // start() throws if called while already started — treat as benign and
        // let the watchdog retry on its next tick.
        running = false;
      }
    },
    stop() {
      try {
        rec?.stop();
      } catch {
        /* ignore */
      }
    },
    abort() {
      aborted = true;
      running = false;
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      rec = null;
    },
  };
  return impl;
}

// ---------------------------------------------------------------------------
// Deepgram SWAP POINT (stub).
//
// To wire Deepgram later: open a mic MediaStream (getUserMedia), stream PCM to
// Deepgram's realtime WebSocket, and translate their interim/final transcript
// messages into onPartial/onFinal/onEnd/onError below. The auth token should
// come from a short-lived, server-minted key (add GET /api/voice/deepgram-token
// that returns a scoped Deepgram key) — never ship the raw DEEPGRAM_API_KEY to
// the browser. Everything else (the loop, the UI, persistence) stays as-is.
// ---------------------------------------------------------------------------
function createDeepgramStt(_opts: { lang?: string }): SpeechToText {
  return {
    supported: false,
    running: false,
    start() {
      throw new Error("Deepgram STT is not wired yet — see the swap point in stt.ts.");
    },
    stop() {},
    abort() {},
  };
}

/**
 * Build a speech-to-text engine. Bind your handlers with the returned object's
 * internal `_bind` via `attachSttHandlers` (below) — kept separate so the same
 * instance can be created once and re-driven across many phrases.
 */
export function createSpeechToText(
  handlers: SttHandlers,
  opts: { provider?: SttProvider; lang?: string; continuous?: boolean } = {}
): SpeechToText {
  const provider = opts.provider ?? "browser";
  const engine =
    provider === "deepgram" ? createDeepgramStt(opts) : createBrowserStt(opts);
  // Bind handlers into the browser impl (the stub ignores this).
  (engine as unknown as { _bind?: (h: SttHandlers) => void })._bind?.(handlers);
  return engine;
}

/** Quick capability check without constructing an engine. */
export function speechRecognitionSupported(): boolean {
  return Boolean(getBrowserRecognitionCtor());
}
