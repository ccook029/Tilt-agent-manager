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
import { playAgentSpeech, type SpeechHandle } from "./tts-playback";

/**
 * Buffer streamed text and call `onSentence` for each complete sentence. A long
 * run with no sentence break is flushed early (at a word boundary) so audio
 * still starts promptly. Call `flush()` at end-of-stream for the tail.
 */
export function createSentenceChunker(onSentence: (sentence: string) => void) {
  let buf = "";
  // Sentence end = . ! ? … FOLLOWED BY whitespace (so "12.5" isn't split), or a
  // line break. The trailing-space requirement means we wait one more token for
  // the boundary, which is fine.
  const BOUNDARY = /[.!?…]\s|\n+/;

  const drain = () => {
    for (;;) {
      const m = BOUNDARY.exec(buf);
      if (!m) break;
      const end = m.index + m[0].length;
      const sentence = buf.slice(0, end).trim();
      buf = buf.slice(end);
      if (sentence) onSentence(sentence);
    }
    // Safety valve: don't sit on a very long clause waiting for punctuation.
    if (buf.length > 220) {
      const cut = buf.lastIndexOf(" ", 200);
      if (cut > 40) {
        const sentence = buf.slice(0, cut).trim();
        buf = buf.slice(cut);
        if (sentence) onSentence(sentence);
      }
    }
  };

  return {
    push(delta: string) {
      buf += delta;
      drain();
    },
    flush() {
      const tail = buf.trim();
      buf = "";
      if (tail) onSentence(tail);
    },
  };
}

/**
 * Plays queued sentences in order, one at a time, through the agent voice.
 * enqueue() as sentences arrive; end() when no more are coming; await drained()
 * to know when everything has finished playing; stop() to cut it off (barge-in).
 */
export class SpeechQueue {
  private pending: string[] = [];
  private playing = false;
  private ended = false;
  private stopped = false;
  private current: SpeechHandle | null = null;
  private firstAudio = false;
  private waiters: Array<() => void> = [];

  constructor(
    private agentId: string,
    private opts: { rate?: number; onFirstAudio?: () => void } = {}
  ) {}

  enqueue(sentence: string) {
    if (this.stopped) return;
    const s = sentence.trim();
    if (s) this.pending.push(s);
    void this.pump();
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
    this.playing = false;
    this.settle(true);
  }

  drained(): Promise<void> {
    if (this.isDone()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private isDone(): boolean {
    return this.stopped || (this.ended && !this.playing && this.pending.length === 0);
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
    const next = this.pending.shift();
    if (next === undefined) {
      this.settle();
      return;
    }
    this.playing = true;
    const handle = playAgentSpeech(this.agentId, next, {
      rate: this.opts.rate,
      onStart: () => {
        if (!this.firstAudio) {
          this.firstAudio = true;
          this.opts.onFirstAudio?.();
        }
      },
    });
    this.current = handle;
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
