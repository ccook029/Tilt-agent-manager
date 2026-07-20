"use client";

// ---------------------------------------------------------------------------
// /zoho/reconnect — owner page to rotate the Zoho refresh token without ever
// touching a terminal or Vercel. Paste a fresh grant code from the Zoho API
// Console; the app exchanges it, stores the new permanent token in KV, and
// verifies Books/Inventory/Sheet are live again.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

const SCOPES =
  "ZohoBooks.fullaccess.all,ZohoInventory.fullaccess.all,ZohoSheet.fullaccess.all";
const CONSOLE_URL = "https://api-console.zoho.com";

type Status = {
  connected: boolean;
  source: "kv" | "env" | "none";
  error?: string;
};

export default function ZohoReconnectPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { ok: boolean; message: string } | null
  >(null);
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/zoho/reconnect");
      const data = await res.json();
      setStatus({ connected: !!data.connected, source: data.source, error: data.error });
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const reconnect = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/zoho/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (data.ok && data.connected) {
        setResult({
          ok: true,
          message:
            "Zoho is reconnected and verified. Books, Inventory, and the stick Sheet are live again — tell Sterling to put Penny back on the categorization pass.",
        });
        setCode("");
        await loadStatus();
      } else {
        setResult({
          ok: false,
          message: data.error ?? "Reconnect failed — generate a fresh code and try again.",
        });
      }
    } catch {
      setResult({ ok: false, message: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  };

  const copyScopes = async () => {
    try {
      await navigator.clipboard.writeText(SCOPES);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-10">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight text-white">
          Reconnect Zoho
        </h1>
        <p className="text-sm text-gray-400">
          One token powers Books, Inventory, and the stick Sheet. If your agents
          start reporting 401 / auth errors, refresh it here — no terminal, no
          Vercel, no redeploy.
        </p>
      </header>

      {/* Status */}
      <div className="rounded-xl border border-gray-800 bg-[#0d0d0d] p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-300">
            Connection status
          </span>
          {checking ? (
            <span className="text-xs text-gray-500">checking…</span>
          ) : status?.connected ? (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-green-400">
              <span className="h-2 w-2 rounded-full bg-green-500" /> Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-red-400">
              <span className="h-2 w-2 rounded-full bg-red-500" /> Not connected
            </span>
          )}
        </div>
        {!checking && status && (
          <p className="mt-2 text-xs text-gray-500">
            Token source: {status.source === "kv" ? "reconnected in-app (KV)" : status.source === "env" ? "environment variable" : "none set"}
            {status.connected === false && status.error ? ` — ${status.error}` : ""}
          </p>
        )}
      </div>

      {/* Steps */}
      <ol className="space-y-5">
        <li className="rounded-xl border border-gray-800 bg-[#0d0d0d] p-4">
          <p className="text-sm font-semibold text-white">
            1 · Generate a grant code in Zoho
          </p>
          <p className="mt-1 text-sm text-gray-400">
            Open the API Console, pick your Self Client, go to{" "}
            <span className="text-gray-300">Generate Code</span>, set duration to
            10 minutes, and paste this into the Scope field:
          </p>
          <div className="mt-3 flex items-stretch gap-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-gray-700 bg-black/40 px-3 py-2 text-xs text-[#00d6ff]">
              {SCOPES}
            </code>
            <button
              onClick={copyScopes}
              className="shrink-0 rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-[#00d6ff]/40"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <a
            href={CONSOLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#00d6ff] hover:text-[#7be9ff]"
          >
            Open Zoho API Console ↗
          </a>
        </li>

        <li className="rounded-xl border border-gray-800 bg-[#0d0d0d] p-4">
          <p className="text-sm font-semibold text-white">
            2 · Paste the code &amp; reconnect
          </p>
          <p className="mt-1 text-sm text-gray-400">
            Copy the generated code (starts with{" "}
            <span className="text-gray-300">1000.</span>) and paste it here. It
            expires within minutes, so do this right away.
          </p>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={3}
            placeholder="1000.xxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxx"
            className="mt-3 w-full resize-y rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:border-[#00d6ff] focus:outline-none"
            disabled={busy}
          />
          <button
            onClick={reconnect}
            disabled={busy || !code.trim()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#00d6ff] px-5 py-2.5 text-sm font-semibold text-[#06232b] transition-colors hover:bg-[#00a6c9] disabled:opacity-40"
          >
            {busy ? "Reconnecting…" : "Reconnect Zoho"}
          </button>
        </li>
      </ol>

      {result && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            result.ok
              ? "border-green-500/30 bg-green-500/[0.07] text-green-200"
              : "border-red-500/30 bg-red-500/[0.07] text-red-200"
          }`}
        >
          {result.message}
        </div>
      )}

      <p className="text-xs text-gray-600">
        This stores the new token in the app itself, so it survives redeploys and
        you won&apos;t need to do it again unless the Zoho account&apos;s password
        is reset or the token is manually revoked.
      </p>
    </div>
  );
}
