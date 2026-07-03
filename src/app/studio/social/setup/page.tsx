"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Status = {
  demoMode: boolean;
  secrets: {
    database: boolean;
    anthropic: boolean;
    blob: boolean;
    workdrive: boolean;
  };
  adminProtected: boolean;
  dbInitialized: boolean;
  dbError: string | null;
  stats: {
    total: number;
    photos: number;
    videos: number;
    tagged: number;
    untagged: number;
  } | null;
};

export default function SetupPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (m: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/social/admin/status", { cache: "no-store" });
      setStatus(await res.json());
    } catch (e) {
      addLog(`Could not load status: ${e}`);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function post(path: string, body: Record<string, unknown>, label: string) {
    setBusy(label);
    addLog(`${label}…`);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, token: token || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        addLog(`✓ ${label} — ${summarize(data)}`);
      } else {
        addLog(`✗ ${label} failed: ${data.error}`);
      }
    } catch (e) {
      addLog(`✗ ${label} error: ${e}`);
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const s = status?.secrets;
  const allSecrets = s && s.database && s.anthropic && s.blob && s.workdrive;

  return (
    <div className="container">
      <p className="tagline">Get started</p>
      <h1>Setup</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 640 }}>
        No terminal needed. Once your secrets are set in Vercel, use the buttons
        below to create the database and pull in your shoot library.
      </p>

      {status?.demoMode && (
        <div
          style={{
            border: "1px solid var(--tilt-cyan)",
            background: "rgba(0,191,255,0.08)",
            borderRadius: 10,
            padding: "12px 16px",
            margin: "8px 0 4px",
            fontSize: "0.88rem",
          }}
        >
          You&apos;re viewing the <strong>preview</strong> with sample data — no
          database is connected, so the action buttons below are inactive. Add a{" "}
          <code style={{ color: "var(--tilt-cyan)" }}>DATABASE_URL</code> in
          Vercel to switch from preview to the real catalog.
        </div>
      )}

      {/* Step 1 — secrets */}
      <h2 style={{ fontSize: "1rem", marginTop: 28 }}>1 · Secrets</h2>
      <div className="stats">
        <Check ok={s?.database} label="Database" />
        <Check ok={s?.anthropic} label="Claude (tags)" />
        <Check ok={s?.blob} label="Blob storage" />
        <Check ok={s?.workdrive} label="WorkDrive" />
      </div>
      {!allSecrets && (
        <p style={{ color: "#ffb020", fontSize: "0.85rem" }}>
          Add any missing secrets in Vercel → Project → Settings → Environment
          Variables, then redeploy and refresh this page.
        </p>
      )}
      {!s?.workdrive && (
        <p style={{ fontSize: "0.85rem" }}>
          Need a WorkDrive refresh token?{" "}
          <Link href="/studio/social/setup/zoho">Use the Zoho helper →</Link>
        </p>
      )}

      {/* Admin token */}
      <div style={{ margin: "16px 0" }}>
        <label style={{ fontSize: "0.8rem", color: "var(--tilt-muted)" }}>
          Admin token{" "}
          {status?.adminProtected ? "(required)" : "(none set — unprotected)"}
        </label>
        <br />
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ADMIN_TOKEN"
          style={inputStyle}
        />
      </div>

      {/* Step 2 — initialize DB */}
      <h2 style={{ fontSize: "1rem", marginTop: 20 }}>2 · Create the database</h2>
      <p style={{ color: "var(--tilt-muted)", fontSize: "0.85rem" }}>
        {status?.dbInitialized
          ? "✓ Database is initialized."
          : "Creates all tables. Safe to run more than once."}
      </p>
      <button
        style={btnStyle(busy === "Initialize database")}
        disabled={!s?.database || busy !== null}
        onClick={() => post("/api/social/admin/migrate", {}, "Initialize database")}
      >
        {busy === "Initialize database" ? "Working…" : "Initialize database"}
      </button>

      {/* Step 3 — sync */}
      <h2 style={{ fontSize: "1rem", marginTop: 24 }}>3 · Sync the catalog</h2>
      <p style={{ color: "var(--tilt-muted)", fontSize: "0.85rem" }}>
        Mirrors your WorkDrive shoot library to Blob and tags it. Start with the
        test run, check <Link href="/studio/social/catalog">the catalog</Link>, then run the
        full sync.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          style={btnStyle(busy === "Test sync (5 files)")}
          disabled={!status?.dbInitialized || busy !== null}
          onClick={() =>
            post("/api/social/catalog/sync", { limit: 5 }, "Test sync (5 files)")
          }
        >
          Test sync (5 files)
        </button>
        <button
          style={btnStyle(busy === "Full sync", true)}
          disabled={!status?.dbInitialized || busy !== null}
          onClick={() => post("/api/social/catalog/sync", {}, "Full sync")}
        >
          Full sync (all files)
        </button>
      </div>

      {status?.stats && (
        <div className="stats" style={{ marginTop: 20 }}>
          <Stat num={status.stats.total} label="Total" />
          <Stat num={status.stats.photos} label="Photos" />
          <Stat num={status.stats.videos} label="Videos" />
          <Stat num={status.stats.tagged} label="Tagged" />
        </div>
      )}

      {status?.dbInitialized && status.stats && status.stats.total > 0 && (
        <Link
          href="/studio/social/catalog"
          style={{
            display: "inline-block",
            marginTop: 8,
            background: "var(--tilt-cyan)",
            color: "var(--tilt-black)",
            fontWeight: 600,
            padding: "10px 20px",
            borderRadius: 8,
          }}
        >
          Review the tagged catalog →
        </Link>
      )}

      {/* Step 4 — generate the plan */}
      <h2 style={{ fontSize: "1rem", marginTop: 28 }}>4 · Generate the plan</h2>
      <p style={{ color: "var(--tilt-muted)", fontSize: "0.85rem" }}>
        Builds the 6-month skeleton and writes the locked 14-day window of posts
        (per-platform copy + gap flags). Needs the database + Claude key. Takes
        up to a minute — it writes each post with the brain. Then review on{" "}
        <Link href="/studio/social/posts">Posts</Link>, <Link href="/studio/social/plan">Plan</Link>, and{" "}
        <Link href="/studio/social/gaps">Gaps</Link>.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          style={btnStyle(busy === "Generate plan")}
          disabled={!status?.dbInitialized || busy !== null}
          onClick={() => post("/api/social/admin/plan/generate", {}, "Generate plan")}
        >
          {busy === "Generate plan" ? "Writing the plan…" : "Generate plan"}
        </button>
        <button
          style={btnStyle(busy === "Render visuals", true)}
          disabled={!status?.dbInitialized || busy !== null}
          onClick={() => post("/api/social/admin/render", {}, "Render visuals")}
        >
          Render visuals (needs Blob + Gemini)
        </button>
      </div>

      {/* Activity log */}
      {log.length > 0 && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: 28 }}>Activity</h2>
          <pre
            style={{
              background: "var(--tilt-dark-gray)",
              border: "1px solid var(--tilt-mid-gray)",
              borderRadius: 10,
              padding: 14,
              fontSize: "0.78rem",
              color: "var(--tilt-text)",
              whiteSpace: "pre-wrap",
              maxHeight: 240,
              overflow: "auto",
            }}
          >
            {log.join("\n")}
          </pre>
        </>
      )}
    </div>
  );
}

function summarize(data: { message?: string; summary?: unknown }): string {
  if (data.message) return data.message;
  if (data.summary) return JSON.stringify(data.summary);
  return "done";
}

function Check({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <div className="stat">
      <div className="num" style={{ color: ok ? "var(--tilt-cyan)" : "#ffb020" }}>
        {ok ? "✓" : "—"}
      </div>
      <div className="label">{label}</div>
    </div>
  );
}

function Stat({ num, label }: { num: number; label: string }) {
  return (
    <div className="stat">
      <div className="num">{num}</div>
      <div className="label">{label}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--tilt-black)",
  border: "1px solid var(--tilt-mid-gray)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--tilt-text)",
  width: 280,
  marginTop: 6,
};

function btnStyle(active: boolean, secondary = false): React.CSSProperties {
  return {
    background: secondary ? "transparent" : "var(--tilt-cyan)",
    color: secondary ? "var(--tilt-cyan)" : "var(--tilt-black)",
    border: secondary ? "1px solid var(--tilt-cyan)" : "none",
    fontWeight: 600,
    padding: "10px 18px",
    borderRadius: 8,
    cursor: active ? "wait" : "pointer",
    opacity: active ? 0.7 : 1,
  };
}
