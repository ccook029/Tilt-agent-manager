"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * No-terminal Zoho WorkDrive token helper. The founder pastes their Self Client
 * credentials + a freshly generated grant code; this exchanges them for a
 * refresh token to drop into Vercel. See docs/zoho-workdrive-setup.md.
 */
export default function ZohoSetupPage() {
  const [accountsDomain, setAccountsDomain] = useState(
    "https://accounts.zoho.com",
  );
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [code, setCode] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exchange() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/social/admin/zoho-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountsDomain,
          clientId,
          clientSecret,
          code,
          token: adminToken || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) setResult(data.refreshToken);
      else setError(data.error);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <p className="tagline">
        <Link href="/studio/social/setup">← Setup</Link>
      </p>
      <h1>Zoho WorkDrive — get a refresh token</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 680 }}>
        A one-time step. Follow the guide, paste the three values below, and
        click <strong>Get refresh token</strong>. Copy the result into Vercel as{" "}
        <code style={codeStyle}>ZOHO_REFRESH_TOKEN</code>, then redeploy.
      </p>

      <ol style={{ color: "var(--tilt-muted)", lineHeight: 1.8, maxWidth: 680 }}>
        <li>
          Open{" "}
          <a href="https://api-console.zoho.com/" target="_blank" rel="noreferrer">
            api-console.zoho.com
          </a>{" "}
          → <strong>Add Client</strong> → <strong>Self Client</strong> → Create.
        </li>
        <li>
          Copy the <strong>Client ID</strong> and <strong>Client Secret</strong>{" "}
          into the fields below (and into Vercel as{" "}
          <code style={codeStyle}>ZOHO_CLIENT_ID</code> /{" "}
          <code style={codeStyle}>ZOHO_CLIENT_SECRET</code>).
        </li>
        <li>
          In the Self Client → <strong>Generate Code</strong> tab, set scope to{" "}
          <code style={codeStyle}>
            WorkDrive.files.READ,WorkDrive.team.READ,ZohoFiles.files.READ
          </code>{" "}
          (the <code style={codeStyle}>ZohoFiles.files.READ</code> scope is
          required to <em>download</em> file contents — without it, listing
          works but downloads fail with INVALID_OAUTHSCOPE), pick a duration
          (10 min is fine), and create. Paste that code below quickly — it
          expires.
        </li>
      </ol>

      <div style={{ display: "grid", gap: 12, maxWidth: 520, marginTop: 12 }}>
        <Field label="Accounts domain (region)">
          <select
            value={accountsDomain}
            onChange={(e) => setAccountsDomain(e.target.value)}
            style={inputStyle}
          >
            <option value="https://accounts.zoho.com">.com (US)</option>
            <option value="https://accounts.zoho.eu">.eu (Europe)</option>
            <option value="https://accounts.zoho.in">.in (India)</option>
            <option value="https://accounts.zoho.com.au">.com.au (Australia)</option>
            <option value="https://accounts.zoho.ca">.ca (Canada)</option>
            <option value="https://accounts.zoho.jp">.jp (Japan)</option>
          </select>
        </Field>
        <Field label="Client ID">
          <input
            style={inputStyle}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </Field>
        <Field label="Client Secret">
          <input
            style={inputStyle}
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </Field>
        <Field label="Grant code (expires quickly!)">
          <input
            style={inputStyle}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Field label="Admin token (only if you set ADMIN_TOKEN)">
          <input
            style={inputStyle}
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
          />
        </Field>
      </div>

      <button
        onClick={exchange}
        disabled={busy || !clientId || !clientSecret || !code}
        style={{
          marginTop: 16,
          background: "var(--tilt-cyan)",
          color: "var(--tilt-black)",
          fontWeight: 600,
          padding: "10px 18px",
          borderRadius: 8,
          border: "none",
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? "Exchanging…" : "Get refresh token"}
      </button>

      {error && (
        <div className="empty" style={{ marginTop: 16, color: "#ffb020" }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: "var(--tilt-cyan)", fontWeight: 600 }}>
            ✓ Your refresh token — paste into Vercel as ZOHO_REFRESH_TOKEN:
          </p>
          <pre
            style={{
              background: "var(--tilt-dark-gray)",
              border: "1px solid var(--tilt-cyan)",
              borderRadius: 10,
              padding: 14,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              fontSize: "0.85rem",
            }}
          >
            {result}
          </pre>
          <p style={{ color: "var(--tilt-muted)", fontSize: "0.82rem" }}>
            Then set <code style={codeStyle}>ZOHO_CLIENT_ID</code>,{" "}
            <code style={codeStyle}>ZOHO_CLIENT_SECRET</code>, and{" "}
            <code style={codeStyle}>ZOHO_WORKDRIVE_ROOT_FOLDER_ID</code> (the
            TILT HOCKEY SHOOT folder) in Vercel and redeploy. Back to{" "}
            <Link href="/studio/social/setup">Setup</Link>.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ fontSize: "0.8rem", color: "var(--tilt-muted)" }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--tilt-black)",
  border: "1px solid var(--tilt-mid-gray)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--tilt-text)",
  width: "100%",
};

const codeStyle: React.CSSProperties = {
  background: "var(--tilt-black)",
  padding: "1px 6px",
  borderRadius: 5,
  color: "var(--tilt-cyan)",
  fontSize: "0.85em",
};
