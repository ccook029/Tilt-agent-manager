"use client";

import { useState } from "react";
import Link from "next/link";
import { STUDIO_PRESETS } from "@/lib/social/studio/presets";
import type { StudioAsset } from "@/lib/social/db/schema";

type PhotoChoice = {
  id: string;
  filename: string;
  thumb: string;
  description: string | null;
};

type Env = {
  demoMode: boolean;
  blob: boolean;
  gemini: boolean;
  anthropic: boolean;
};

export function StudioClient({
  env,
  photos,
  initialGallery,
  error,
}: {
  env: Env;
  photos: PhotoChoice[];
  initialGallery: StudioAsset[];
  error: string | null;
}) {
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState(STUDIO_PRESETS[0].key);
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);
  const [baseAssetId, setBaseAssetId] = useState<string | null>(null);
  const [withLogo, setWithLogo] = useState(true);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [gallery, setGallery] = useState<StudioAsset[]>(initialGallery);

  // Generation needs a real backend (DB + Blob + Gemini). In preview mode the
  // gallery still shows samples but the button is inactive — same pattern as Setup.
  const canGenerate = !env.demoMode && env.blob && env.gemini;

  async function generate() {
    if (!prompt.trim()) {
      setMsg("Describe what you want to make.");
      return;
    }
    setBusy(true);
    setMsg("Generating… composing the brief, rendering, and branding it.");
    try {
      const res = await fetch("/api/social/studio/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          preset,
          width: preset === "custom" ? customW : undefined,
          height: preset === "custom" ? customH : undefined,
          baseAssetId,
          withLogo,
          token: token || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setGallery((g) => [data.asset as StudioAsset, ...g]);
        setMsg(
          `✓ Done — "${data.asset.title}"${
            data.source === "fallback" ? " (brief built without Claude)" : ""
          }${data.safety && !data.safety.safe ? " · ⚠ review: " + data.safety.violations.join(", ") : ""}`,
        );
      } else {
        setMsg(`✗ ${data.error}`);
      }
    } catch (e) {
      setMsg(`✗ ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!canGenerate && (
        <div style={noticeStyle}>
          {env.demoMode ? (
            <>
              You&apos;re viewing the <strong>preview</strong> with sample pieces —
              generation is inactive until a backend is connected. Add{" "}
              <code style={{ color: "var(--tilt-cyan)" }}>DATABASE_URL</code>,{" "}
              <code style={{ color: "var(--tilt-cyan)" }}>BLOB_READ_WRITE_TOKEN</code>,
              and <code style={{ color: "var(--tilt-cyan)" }}>GEMINI_API_KEY</code> in
              Vercel.
            </>
          ) : (
            <>
              To generate, add the missing secrets in Vercel:{" "}
              {!env.blob && <code>BLOB_READ_WRITE_TOKEN</code>}{" "}
              {!env.gemini && <code>GEMINI_API_KEY</code>}. See <Link href="/studio/social/setup">Setup</Link>.
            </>
          )}
        </div>
      )}

      {/* ---- Composer ---- */}
      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: "1rem" }}>Make something</h2>

        <label style={labelStyle}>What do you want to make?</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A desktop background for the company — dark, bold, cyan energy, with our 'Don't be a sheep' line."
          rows={3}
          style={{ ...inputStyle, width: "100%", maxWidth: 720, resize: "vertical" }}
        />

        <label style={labelStyle}>Size</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            style={{ ...inputStyle, width: 280 }}
          >
            {STUDIO_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} — {p.hint}
              </option>
            ))}
            <option value="custom">Custom size…</option>
          </select>
          {preset === "custom" && (
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="number"
                value={customW}
                onChange={(e) => setCustomW(Number(e.target.value))}
                style={{ ...inputStyle, width: 110 }}
                aria-label="width"
              />
              <span style={{ color: "var(--tilt-muted)" }}>×</span>
              <input
                type="number"
                value={customH}
                onChange={(e) => setCustomH(Number(e.target.value))}
                style={{ ...inputStyle, width: 110 }}
                aria-label="height"
              />
            </span>
          )}
        </div>

        {/* Base photo (optional) */}
        <label style={labelStyle}>
          Build on a real photo? <span style={{ color: "var(--tilt-muted)" }}>(optional)</span>
        </label>
        <p style={{ color: "var(--tilt-muted)", fontSize: "0.8rem", margin: "0 0 8px" }}>
          Pick a photo when the piece should feature a real player, product, or
          team. Leave it unselected for an abstract brand graphic.
        </p>
        {photos.length === 0 ? (
          <p style={{ color: "var(--tilt-muted)", fontSize: "0.82rem" }}>
            No catalog photos yet — sync the library on <Link href="/studio/social/setup">Setup</Link>.
          </p>
        ) : (
          <div style={pickerStyle}>
            <button
              type="button"
              onClick={() => setBaseAssetId(null)}
              style={photoTileStyle(baseAssetId === null, true)}
            >
              None
              <br />
              <span style={{ fontSize: "0.7rem", color: "var(--tilt-muted)" }}>
                abstract
              </span>
            </button>
            {photos.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setBaseAssetId(p.id)}
                title={p.description ?? p.filename}
                style={photoTileStyle(baseAssetId === p.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt={p.filename} style={photoImgStyle} />
              </button>
            ))}
          </div>
        )}

        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={withLogo}
            onChange={(e) => setWithLogo(e.target.checked)}
          />
          Add the TILT brand anchor (bottom band + wordmark)
        </label>

        <div style={{ margin: "8px 0" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--tilt-muted)" }}>
            Admin token (if set)
          </label>
          <br />
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ADMIN_TOKEN"
            style={{ ...inputStyle, width: 280 }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            className="btn"
            onClick={generate}
            disabled={busy || !canGenerate}
            style={{ opacity: busy || !canGenerate ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
          >
            {busy ? "Generating…" : "Generate"}
          </button>
        </div>

        {msg && (
          <p style={{ marginTop: 12, fontSize: "0.86rem", color: "var(--tilt-text)" }}>{msg}</p>
        )}
      </section>

      {/* ---- Gallery ---- */}
      <section style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: "1rem" }}>Generated pieces</h2>
        {error ? (
          <div className="empty">
            <p>Couldn&apos;t load the Studio gallery.</p>
            <p style={{ fontSize: "0.8rem" }}>{error}</p>
          </div>
        ) : gallery.length === 0 ? (
          <div className="empty">
            <p>Nothing generated yet.</p>
            <p>Describe a piece above and hit Generate.</p>
          </div>
        ) : (
          <div className="grid" style={{ marginTop: 12 }}>
            {gallery.map((a) => (
              <StudioCard key={a.id} asset={a} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function StudioCard({ asset }: { asset: StudioAsset }) {
  return (
    <article className="card">
      <div className="media" style={{ aspectRatio: `${asset.width} / ${asset.height}` }}>
        {asset.renderUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.renderUrl} alt={asset.title} />
        ) : (
          <span className="placeholder">no render</span>
        )}
      </div>
      <div className="body">
        <span className="filename">{asset.title}</span>
        <div className="tags">
          <span className="chip cyan">{asset.kind}</span>
          <span className="chip">
            {asset.width}×{asset.height}
          </span>
          {asset.baseAssetId && <span className="chip">real photo</span>}
        </div>
        {asset.renderUrl && (
          <a
            className="btn btn--ghost"
            href={asset.renderUrl}
            download
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: "0.78rem", padding: "7px 14px", textAlign: "center" }}
          >
            Download
          </a>
        )}
      </div>
    </article>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  color: "var(--tilt-muted)",
  margin: "16px 0 6px",
};

const inputStyle: React.CSSProperties = {
  background: "var(--tilt-black)",
  border: "1px solid var(--tilt-mid-gray)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--tilt-text)",
  fontFamily: "inherit",
  fontSize: "0.9rem",
};

const noticeStyle: React.CSSProperties = {
  border: "1px solid var(--tilt-cyan)",
  background: "rgba(0,191,255,0.08)",
  borderRadius: 10,
  padding: "12px 16px",
  margin: "16px 0 4px",
  fontSize: "0.86rem",
};

const pickerStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  overflowX: "auto",
  padding: "4px 2px 10px",
};

function photoTileStyle(active: boolean, isNone = false): React.CSSProperties {
  return {
    flex: "0 0 auto",
    width: 86,
    height: 86,
    borderRadius: 8,
    border: `2px solid ${active ? "var(--tilt-cyan)" : "var(--tilt-mid-gray)"}`,
    background: "var(--tilt-dark-gray)",
    color: "var(--tilt-text)",
    cursor: "pointer",
    overflow: "hidden",
    padding: 0,
    fontSize: "0.74rem",
    display: isNone ? "flex" : "block",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  };
}

const photoImgStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};
