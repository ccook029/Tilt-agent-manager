"use client";

// ---------------------------------------------------------------------------
// /publish — the owner's publishing console for IG / TikTok / Facebook.
//
// Shows which platforms are connected, the approved queue waiting to go live,
// and recent publish history. Chris posts approved pieces with one tap (the
// "approve trigger" for going live). No content is created here — only
// already-approved Studio pieces are published.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Connection {
  platform: string;
  connected: boolean;
  detail: string;
}
interface QueueItem {
  id: string;
  platform: string;
  copy: string;
  renderUrl?: string | null;
  renderKind?: string | null;
  scheduledDate?: string | null;
}
interface LogEntry {
  at: string;
  platform: string;
  ok: boolean;
  caption: string;
  externalId?: string;
  permalink?: string;
  error?: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

export default function PublishPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [dbConfigured, setDbConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/org/publish").then((r) => r.json()).catch(() => ({}));
    setConnections(d.connections ?? []);
    setQueue(d.queue ?? []);
    setLog(d.log ?? []);
    setDbConfigured(d.databaseConfigured ?? false);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const publish = async (payload: object, key: string) => {
    setBusy(key);
    try {
      await fetch("/api/org/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const anyConnected = connections.some((c) => c.connected);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
            Publish
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Approved content, ready to go live on Instagram, TikTok, and
            Facebook. You post it — nothing publishes on its own.
          </p>
        </div>
        <Link
          href="/review"
          className="rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700"
        >
          ← Review
        </Link>
      </div>

      {/* Connections */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {connections.map((c) => (
          <div
            key={c.platform}
            className={`rounded-xl border p-4 ${
              c.connected
                ? "border-emerald-800/50 bg-emerald-950/10"
                : "border-gray-800/60 bg-[#111]/40"
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-200">
                {PLATFORM_LABEL[c.platform] ?? c.platform}
              </p>
              <span
                className={`h-2 w-2 rounded-full ${
                  c.connected ? "bg-emerald-400" : "bg-gray-600"
                }`}
              />
            </div>
            <p className="mt-1 text-[11px] text-gray-500">{c.detail}</p>
            {c.platform === "tiktok" && !c.connected && (
              <a
                href="/api/publish/tiktok/auth"
                className="mt-2 inline-block rounded-md bg-[#0094b8] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#00a8d1]"
              >
                Connect TikTok
              </a>
            )}
          </div>
        ))}
      </section>

      {!dbConfigured && (
        <div className="rounded-xl border border-amber-800/40 bg-amber-950/10 p-4 text-xs text-amber-200">
          The Social Studio database isn&apos;t configured in this environment, so
          there&apos;s no approved queue to publish from yet. Connect it to see
          approved posts here.
        </div>
      )}

      {/* Queue */}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Approved queue — {queue.length}
              </h2>
              {queue.length > 0 && anyConnected && (
                <button
                  onClick={() => publish({ action: "publish-all" }, "all")}
                  disabled={busy === "all"}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                >
                  {busy === "all" ? "Posting…" : "Publish all"}
                </button>
              )}
            </div>
            {queue.length === 0 ? (
              <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">
                Nothing approved and waiting. Approved Studio posts with rendered
                media show up here.
              </div>
            ) : (
              queue.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center gap-3 rounded-xl border border-gray-800/60 bg-[#0d0d0d] p-3"
                >
                  {q.renderUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={q.renderUrl}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-md object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500">
                      {PLATFORM_LABEL[q.platform] ?? q.platform}
                      {q.renderKind === "shotstack" ? " · video" : " · image"}
                    </p>
                    <p className="truncate text-xs text-gray-300">{q.copy}</p>
                  </div>
                  <button
                    onClick={() =>
                      publish({ action: "publish-post", postId: q.id }, q.id)
                    }
                    disabled={busy === q.id || !anyConnected}
                    title={!anyConnected ? "Connect a platform first" : ""}
                    className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                  >
                    {busy === q.id ? "…" : "Publish"}
                  </button>
                </div>
              ))
            )}
          </section>

          {/* History */}
          {log.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Recent activity
              </h2>
              {log.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-gray-800/50 bg-[#0d0d0d] px-3 py-2 text-xs"
                >
                  <span className={e.ok ? "text-emerald-400" : "text-red-400"}>
                    {e.ok ? "✓" : "✗"}
                  </span>
                  <span className="text-gray-500">
                    {PLATFORM_LABEL[e.platform] ?? e.platform}
                  </span>
                  <span className="truncate text-gray-400">{e.caption}</span>
                  <span className="ml-auto shrink-0 text-gray-600">
                    {e.at.slice(0, 10)}
                  </span>
                  {e.permalink && (
                    <a
                      href={e.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-[#00d6ff] hover:underline"
                    >
                      view
                    </a>
                  )}
                  {!e.ok && e.error && (
                    <span className="shrink-0 text-red-500/70" title={e.error}>
                      failed
                    </span>
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
