// ---------------------------------------------------------------------------
// voice-client.ts — client-side reader for the streaming voice reply.
//
// POSTs to /api/agents/voice-chat and yields text deltas as they arrive so the
// UI can begin speaking the first sentence while Sterling is still writing.
// ---------------------------------------------------------------------------

export async function streamVoiceReply(
  message: string,
  handlers: { onDelta: (delta: string) => void; signal?: AbortSignal }
): Promise<string> {
  const res = await fetch("/api/agents/voice-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal: handlers.signal,
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `voice-chat ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) {
      full += chunk;
      handlers.onDelta(chunk);
    }
  }
  full += decoder.decode();
  return full;
}
