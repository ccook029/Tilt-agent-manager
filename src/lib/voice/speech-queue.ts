// ---------------------------------------------------------------------------
// speech-queue.ts — speak a streaming reply sentence-by-sentence.
//
// Two pieces that turn a token stream into fluid speech:
//   • createSentenceChunker — buffers deltas and emits complete sentences as
//     soon as they land, so we can start speaking before generation finishes.
//   • SpeechQueue — plays those sentences back-to-back through the existing TTS
//     (playAgentSpeech), firing onFirstAudio the moment sound actually starts.
//
// Net effect: Sterling begins talking ~1s after you finish, and keeps talking
// as the rest of his answer streams in — instead of waiting for the whole reply.
// ---------------------------------------------------------------------------
import {
  prepareAgentSpeech,
  type PreparedSpeech,
  type SpeechHandle,
} from "./tts-playback";

/**
 * Buffer streamed text and call `onSentence` for each complete sentence. A long
 * run with no sentence break is flushed early (at a word boundary) so audio
 * still starts promptly. Call `flush()` at end-of-stream for the tail.
 */
export function createSentenceChunker(onSentence: (sentence: string) => void) {
  let buf = "";
  /** Complete sentences held back to be spoken as one clip. */
  let ready = "";
  let emitted = 0;
  // Sentence end = . ! ? … FOLLOWED BY whitespace (so "12.5" isn't split), or a
  // line break. The trailing-space requirement means we wait one more token for
  // the boundary, which is fine.
  const BOUNDARY = /[.!?…]\s|\n+/;
  /**
   * After the opener, batch sentences up to roughly this length before
   * synthesising. Every chunk is a separate request, and conversational replies
   * are full of four-word sentences — "Sure." "Let me check." — each of which
   * used to cost its own round-trip and its own seam in the audio. Fewer,
   * longer clips means fewer places it can stutter.
   */
  const MIN_CHARS = 140;

  /**
   * True while we're inside an unclosed ``` fence. Control blocks (```assign,
   * ```dispatch) are stripped for the ear as whole blocks, so a chunk boundary
   * landing in the middle of one would leave half a JSON object in a clip and
   * read it out literally. Nothing is emitted until the fence closes.
   */
  let inFence = false;

  /** Move text from `buf` into `ready`, tracking fence state as it goes. */
  const consume = (n: number) => {
    const taken = buf.slice(0, n);
    buf = buf.slice(n);
    ready += taken;
    const fences = taken.split("```").length - 1;
    if (fences % 2 === 1) inFence = !inFence;
  };

  const emit = () => {
    if (inFence) return;
    const out = ready.trim();
    ready = "";
    if (out) {
      emitted++;
      onSentence(out);
    }
  };

  const drain = () => {
    for (;;) {
      const m = BOUNDARY.exec(buf);
      if (!m) break;
      consume(m.index + m[0].length);
      // The first chunk goes the moment it's ready — that's what makes the
      // agent start talking a second after you stop. Everything after it is
      // batched, because by then we're buying smoothness, not a fast start.
      if (emitted === 0 || ready.trim().length >= MIN_CHARS) emit();
    }
    // Safety valve: don't sit on a very long clause waiting for punctuation.
    // Suspended inside a fence — a block has no sentence breaks and must stay
    // whole.
    if (!inFence && buf.length > 220) {
      const cut = buf.lastIndexOf(" ", 200);
      if (cut > 40) {
        consume(cut);
        emit();
      }
    }
  };

  return {
    push(delta: string) {
      buf += delta;
      drain();
    },
    flush() {
      ready += buf;
      buf = "";
      // End of stream: whatever fence state we're in, this is the last of it.
      inFence = false;
      emit();
    },
  };
}

/**
 * Plays queued sentences in order, one at a time, through the agent voice.
 * enqueue() as sentences arrive; end() when no more are coming; await drained()
 * to know when everything has finished playing; stop() to cut it off (barge-in).
 */
/**
 * How many sentences to synthesise ahead of the one being spoken.
 *
 * The gap that made speech choppy was structural: a sentence's audio was only
 * requested once the previous sentence had finished playing, so every boundary
 * cost a full round-trip of silence. Two ahead is enough to cover a slow
 * request on a phone without stacking up work we'd throw away on barge-in.
 */
const LOOKAHEAD = 2;

export class SpeechQueue {
  private pending: string[] = [];
  private prepared: PreparedSpeech[] = [];
  private playing = false;
  private ended = false;
  private stopped = false;
  private current: SpeechHandle | null = null;
  private firstAudio = false;
  private waiters: Array<() => void> = [];
  /** Latched once the server voice fails, so the rest of the reply stays in
   *  one voice instead of flipping between the agent and the browser. */
  private browserOnly = false;

  constructor(
    private agentId: string,
    private opts: { rate?: number; onFirstAudio?: () => void } = {}
  ) {}

  enqueue(sentence: string) {
    if (this.stopped) return;
    const s = sentence.trim();
    if (s) this.pending.push(s);
    this.topUp();
    void this.pump();
  }

  /** Start synthesising the next few sentences while the current one plays. */
  private topUp() {
    while (!this.stopped && this.prepared.length < LOOKAHEAD && this.pending.length > 0) {
      const text = this.pending.shift()!;
      this.prepared.push(
        prepareAgentSpeech(this.agentId, text, {
          rate: this.opts.rate,
          preferBrowser: this.browserOnly,
          onFallback: () => {
            this.browserOnly = true;
          },
        })
      );
    }
  }

  /** No more sentences will be enqueued. */
  end() {
    this.ended = true;
    this.settle();
  }

  /** Cut playback immediately (barge-in / end session). */
  stop() {
    this.stopped = true;
    this.pending = [];
    this.current?.stop();
    this.current = null;
    // Clips already downloading are abandoned too, or they'd keep buffering
    // (and, on the next pump, could speak over the top of a new reply).
    this.prepared.forEach((p) => p.discard());
    this.prepared = [];
    this.playing = false;
    this.settle(true);
  }

  drained(): Promise<void> {
    if (this.isDone()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private isDone(): boolean {
    return (
      this.stopped ||
      (this.ended &&
        !this.playing &&
        this.pending.length === 0 &&
        this.prepared.length === 0)
    );
  }

  private settle(force = false) {
    if (force || this.isDone()) {
      const w = this.waiters;
      this.waiters = [];
      w.forEach((r) => r());
    }
  }

  private async pump() {
    if (this.playing || this.stopped) return;
    this.topUp();
    const next = this.prepared.shift();
    if (next === undefined) {
      this.settle();
      return;
    }
    this.playing = true;
    const handle = next.play({
      onStart: () => {
        if (!this.firstAudio) {
          this.firstAudio = true;
          this.opts.onFirstAudio?.();
        }
      },
    });
    this.current = handle;
    // Refill the moment playback starts, so the clip after this one is already
    // downloading while the listener is hearing this one. This line is the fix.
    this.topUp();
    await handle.done;
    this.current = null;
    this.playing = false;
    if (this.stopped) {
      this.settle(true);
      return;
    }
    void this.pump();
  }
}
