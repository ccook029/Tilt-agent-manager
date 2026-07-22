# Voice Mode (hands-free / driving)

A hands-free voice layer on top of the **existing** Sterling (CFO) chat. It does
**not** add a parallel agent or a new datastore — it drives the same backend the
typed chat uses, so the system prompt, business context, and saved transcript
are identical to typing.

## The loop

```
tap 🎙 Voice → listen → transcribe → POST /api/accounting-manager/run (mode:"chat")
            → speak the reply aloud → auto-reopen the mic → (repeat) → End
```

Everything the voice turn produces is persisted by the **same** route into the
**same** Vercel KV transcript (`cfo-chat-store`) — no new schema.

## Files

| Piece | File | Notes |
|---|---|---|
| Voice UI (car overlay + loop) | `src/components/voice/car-voice-mode.tsx` | one big button, 5-state loop, barge-in, End |
| Speech-to-text | `src/lib/voice/stt.ts` | **Deepgram swap point here** |
| Text-to-speech playback | `src/lib/voice/tts-playback.ts` | plays existing `/api/agents/tts` (ElevenLabs swap is in that route) |
| Spoken-text cleaner | `src/lib/voice/speakable.ts` | strips markdown/JSON so TTS doesn't read symbols |
| Mount + reuse of chat send | `src/components/agent-chat.tsx` | `sendMessage()` returns the reply text; `enableVoice` prop |
| Enabled for Sterling | `src/components/cfo-chat.tsx` | `<AgentChat enableVoice … />` |
| Concise-for-driving hint | `src/lib/accounting-loop.ts`, `src/app/api/accounting-manager/run/route.ts` | `voice:true` → 1–3 short spoken sentences (same brain, shorter delivery) |

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
