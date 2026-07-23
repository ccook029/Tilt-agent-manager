// ---------------------------------------------------------------------------
// voice-client.ts — client-side reader for the voice reply.
//
// Primary path: POST /api/agents/voice-chat and yield text deltas as they
// arrive, so the UI can start speaking the first sentence while the agent is
// still writing.
//
// Fallback path: if streaming fails for ANY reason (a dropped stream, a proxy
// that buffers streamed responses, a transient 5xx), retry the same route in
// non-streaming mode (`stream: false`) so the agent still answers — just as one
// chunk instead of sentence-by-sentence. Only if BOTH fail do we surface the
// error, with the real status so it's diagnosable.
// ---------------------------------------------------------------------------

async function streamOnce(
  message: string,
  agentId: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch("/api/agents/voice-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, agentId }),
    signal,
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      try {
        detail = (await res.text()).slice(0, 140);
      } catch {
        /* ignore */
      }
    }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  if (!res.body) throw new Error("no response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) {
      full += chunk;
      onDelta(chunk);
    }
  }
  full += decoder.decode();
  if (!full.trim()) throw new Error("empty stream");
  return full;
}

async function bufferedOnce(message: string, agentId: string): Promise<string> {
  const res = await fetch("/api/agents/voice-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, agentId, stream: false }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const data = (await res.json().catch(() => ({}))) as { reply?: string };
  return (data.reply ?? "").toString();
}

export async function streamVoiceReply(
  message: string,
  handlers: { onDelta: (delta: string) => void; signal?: AbortSignal; agentId?: string }
): Promise<string> {
  const agentId = handlers.agentId ?? "sterling";
  try {
    return await streamOnce(message, agentId, handlers.onDelta, handlers.signal);
  } catch (streamErr) {
    // Streaming failed — fall back to a single buffered reply so the agent
    // still talks. If that also comes back empty/errored, surface the reason.
    const reply = await bufferedOnce(message, agentId);
    if (reply.trim()) {
      handlers.onDelta(reply);
      return reply;
    }
    throw streamErr;
  }
}
