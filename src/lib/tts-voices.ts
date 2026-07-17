// ---------------------------------------------------------------------------
// tts-voices.ts — per-employee voice assignments (Vercel KV)
//
// Chris can point any employee at any voice in the ElevenLabs account —
// premium voices, cloned voices (e.g. Jeremy's) — from the picker on
// /org/[id]. Employees without an assignment get a stable default from the
// provider's pool (hashed by id in the TTS route).
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "tts-voice-map";

export type VoiceMap = Record<string, string>; // agentId → ElevenLabs voice_id

export async function getVoiceMap(): Promise<VoiceMap> {
  return (await kv.get<VoiceMap>(KEY)) ?? {};
}

export async function setVoice(
  agentId: string,
  voiceId: string | null
): Promise<VoiceMap> {
  const map = await getVoiceMap();
  if (voiceId) map[agentId] = voiceId;
  else delete map[agentId];
  await kv.set(KEY, map);
  return map;
}
