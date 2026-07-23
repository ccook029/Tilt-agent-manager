# Voice Mode (hands-free, real-time)

A hands-free, **real-time** voice conversation on top of the **existing** agent
chats. It does **not** add a parallel agent or a new datastore — it drives the
same agents, personas, and KV transcripts as typing. Tuned to feel like
ChatGPT/Claude voice: the agent starts talking about a second after you finish
and keeps talking as the rest streams in.

## Two voices

| Agent | Where | Knows | Ask it… |
|---|---|---|---|
| **Reese Calder** — Chief of Staff | `/org/chief-of-staff` | the **whole company** (freshest output from every function + the founders' decision queue) | "Where are we at? What shipped? What's in R&D? What needs me?" |
| **Sterling Vance** — CFO | `/strategy` | deep **finance** (books, metrics, projections) | "Walk me through the margins / cash / this month's numbers." |

Reese is the "walk in and ask where we're at" agent; Sterling is the finance
deep-dive. Both stream, both save to their own transcript.

### Org wiring behind Reese
The eight department heads (CFO, Marketing, Inventory, Product/R&D, Web, Team &
Apparel, Business Development, CX) now **report to the Chief of Staff** in the
directory (`reportsTo: "chief-of-staff"`), so Reese natively sees across all of
them. The human owner gate is unchanged — approvals still land in the founders'
Review queue, which sits above every `reportsTo: null` position (now just
Reese). Reese's voice context is a fast, company-wide snapshot (all agents'
latest run logs + open decisions), not the slow per-department assembly.

## The loop

```
tap 🎙 Voice → listen → transcribe → STREAM the reply from Sterling
            → speak it sentence-by-sentence (starts before it's fully written)
            → auto-reopen the mic → (repeat) → End
```

Everything a voice turn produces is persisted into the **same** Vercel KV
transcript (`cfo-chat-store`) as the typed chat — no new schema.

## Why it feels real-time (the snappy path)

The typed CFO chat is thorough-but-slow: it assembles heavy live-Zoho context
(financial projections, the AP inbox) and returns one big block. Voice Mode uses
a **separate, lighter path** built for conversation:

- **Streaming route** `POST /api/agents/voice-chat` streams tokens as they're
  written (`streamClaudeText` in `anthropic.ts`).
- **Light, fast context** (`src/lib/voice/voice-chat.ts`): company knowledge +
  open decisions + Penny's latest headlines — all fast KV reads. It skips the
  slow live-Zoho assembly; Sterling offers to pull deep numbers in the full chat
  when a question needs them.
- **Short spoken answers** (1–3 sentences, no markdown).
- **Sentence-chunked speech** (`src/lib/voice/speech-queue.ts`): the client
  speaks each sentence the moment it lands instead of waiting for the whole
  reply.

Same brain (Sterling on Sonnet 5), same persona (`cfoConfig.systemPrompt`), same
transcript — only the delivery is faster.

## Files

| Piece | File | Notes |
|---|---|---|
| Voice UI (overlay + loop) | `src/components/voice/car-voice-mode.tsx` | one big button, 5-state loop, barge-in, End |
| Streaming voice brain | `src/lib/voice/voice-chat.ts` | light context + short spoken answers; persists to the shared transcript |
| Streaming route | `src/app/api/agents/voice-chat/route.ts` | streams Sterling's reply token-by-token |
| Streaming Claude helper | `src/lib/anthropic.ts` (`streamClaudeText`) | text-only streaming completion |
| Sentence-chunked speech | `src/lib/voice/speech-queue.ts` | speak each sentence as it lands |
| Stream reader (client) | `src/lib/voice/voice-client.ts` | reads the streamed reply, yields deltas |
| Speech-to-text | `src/lib/voice/stt.ts` | **Deepgram swap point here** |
| Text-to-speech playback | `src/lib/voice/tts-playback.ts` | plays existing `/api/agents/tts` (ElevenLabs swap is in that route) |
| Spoken-text cleaner | `src/lib/voice/speakable.ts` | strips markdown/JSON so TTS doesn't read symbols |
| Shared transcript persist | `src/lib/accounting-loop.ts` (`persistCfoChatTurn`) | typed + voice write the same KV store |
| Mount + streaming glue | `src/components/agent-chat.tsx` | `streamReply()` shows the turn + streams deltas; `enableVoice` prop |
| Enabled for Sterling | `src/components/cfo-chat.tsx` | `<AgentChat enableVoice … />` |

## Reused, not rebuilt

- **Backend / context / history:** `runCfoChat` → `runAgentChat` → `callClaude` in
  `src/lib/accounting-loop.ts`; transcript in `src/lib/cfo-chat-store.ts` (KV).
- **TTS:** the existing `/api/agents/tts` ladder — **ElevenLabs → Gemini →
  browser** — already picks the best available voice server-side.

## Swap points

- **Deepgram (STT):** implement `createDeepgramStt` in `src/lib/voice/stt.ts`
  and change the default in `createSpeechToText` to `"deepgram"`. Add a route
  that mints a short-lived Deepgram key (`GET /api/voice/deepgram-token`) — never
  ship `DEEPGRAM_API_KEY` to the browser. Nothing else changes.
- **ElevenLabs (TTS):** already wired. Top of the ladder whenever
  `ELEVENLABS_API_KEY` is set (see `src/app/api/agents/tts/route.ts`).

## Environment variables

**Nothing new is required to ship.** Voice input uses the browser's built-in
Web Speech API (no key), and voice output reuses the TTS route you already have.

Optional, all pre-existing:

| Var | Effect |
|---|---|
| `ELEVENLABS_API_KEY` | best-quality spoken voice (falls back to Gemini, then the browser voice) |
| `ELEVENLABS_MODEL` | default `eleven_turbo_v2_5`; set `eleven_multilingual_v2` for more polish, more latency |
| `GEMINI_API_KEY` | second-choice server voice if ElevenLabs isn't set |
| `DEEPGRAM_API_KEY` | only when you wire the Deepgram STT swap point (server-side only) |

## Browser notes

- Web Speech API works best in **Chrome/Edge** and **Safari on iOS**. Firefox
  has no support — Voice Mode shows a "type instead" message and stays graceful.
- Voice Mode opens on a tap (a user gesture), which is what unlocks audio
  autoplay and the mic prompt. Grant the mic once per site.
- If speech recognition drops, the overlay shows the last transcript and a
  one-tap retry (tap the circle).
