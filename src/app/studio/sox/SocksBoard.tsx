"use client";

import { useState } from "react";
import type { SockDesign } from "@/lib/social/db/schema";
import { useAdminToken } from "@/components/social/useAdminToken";

/**
 * Sock Design workspace: a B2B design + pitch tool. Upload an org logo, name the
 * team colors, and the agent designs a dress sock mockup in those colors carrying
 * the logo, then builds a Tilt-branded pitch flyer around it. Each card shows both
 * the product mockup and the sales flyer, with separate redo controls.
 */
export default function SocksBoard({
  initial,
  demo,
  adminProtected,
  loadError,
}: {
  initial: SockDesign[];
  demo: boolean;
  adminProtected: boolean;
  loadError: string | null;
}) {
  const [items, setItems] = useState<SockDesign[]>(initial);
  const { token, setToken } = useAdminToken();
  const [notice, setNotice] = useState<string | null>(null);

  // Form state
  const [orgName, setOrgName] = useState("");
  const [colors, setColors] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!orgName.trim()) {
      setNotice("Add the organization name first.");
      return;
    }
    if (!file) {
      setNotice("Upload the org logo.");
      return;
    }
    setNotice(null);
    setBusy(true);
    try {
      const logoBase64 = await fileToBase64(file);
      const res = await fetch("/api/social/admin/socks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgName: orgName.trim(),
          colors: colors.trim() || undefined,
          note: note.trim() || undefined,
          logoBase64,
          logoMime: file.type || "image/png",
          token: token || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Generate failed (${res.status}).`);
      }
      setItems((prev) => [data.sock, ...prev]);
      setOrgName("");
      setColors("");
      setNote("");
      setFile(null);
      setNotice("Sock design + pitch flyer generated — review them below.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function patchLocal(id: string, fields: Partial<SockDesign>) {
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  }

  function removeLocal(id: string) {
    setItems((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="container">
      <p className="tagline">B2B · custom dress socks</p>
      <h1>Sock Designs</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 680 }}>
        Design custom dress socks for an organization and pitch them. Upload the
        org logo, name the team colors — the agent designs a sock mockup in those
        colors carrying the crest, then builds a Tilt-branded pitch flyer around it.
        The sock mockup is the org&apos;s product (no Tilt mark); the flyer carries
        the TILT wordmark, composited by code.
      </p>

      {demo && (
        <div className="preview-note">
          Preview mode — generating sock designs needs a database plus the Claude,
          Gemini, and Blob keys in Vercel.
        </div>
      )}
      {loadError && (
        <div className="action-error" role="status">
          Couldn&apos;t load sock designs: {loadError}
        </div>
      )}

      {adminProtected && (
        <div style={{ margin: "14px 0 4px" }}>
          <label style={{ fontSize: "0.78rem", color: "var(--tilt-muted)" }}>
            Admin token (required to generate)
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
      )}

      {/* New sock design form */}
      <div style={formCardStyle}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Organization name (e.g. Jr. Lady Sting)"
            style={{ ...inputStyle, flex: "1 1 240px" }}
          />
          <input
            value={colors}
            onChange={(e) => setColors(e.target.value)}
            placeholder="Team colors (e.g. Yellow, silver, black)"
            style={{ ...inputStyle, flex: "1 1 240px" }}
          />
        </div>

        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}>Style note (optional)</label>
          <br />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any design direction (stripe style, where the logo sits, vibe, etc.)"
            rows={2}
            style={{ ...inputStyle, width: "100%", marginTop: 6, resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <div style={{ margin: "12px 0" }}>
          <label style={labelStyle}>
            Org logo / crest — PNG with a transparent background works best
          </label>
          <br />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ marginTop: 6, fontSize: "0.85rem", color: "var(--tilt-text)" }}
          />
        </div>

        <button className="act act--primary" disabled={busy || demo} onClick={generate}>
          {busy ? "Designing… (a minute or two)" : "Design socks + pitch flyer"}
        </button>
      </div>

      {notice && (
        <div className="action-error" role="status">
          {notice}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <p>No sock designs yet.</p>
          <p>Generate the first one above — upload a logo and name the colors.</p>
        </div>
      ) : (
        <div className="post-grid" style={{ marginTop: 24 }}>
          {items.map((s) => (
            <SockCard
              key={s.id}
              s={s}
              token={token}
              onPatch={patchLocal}
              onRemove={removeLocal}
              onNotice={setNotice}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SockCard({
  s,
  token,
  onPatch,
  onRemove,
  onNotice,
}: {
  s: SockDesign;
  token: string;
  onPatch: (id: string, fields: Partial<SockDesign>) => void;
  onRemove: (id: string) => void;
  onNotice: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState(s.revisionNote ?? "");

  async function action(label: string, init: RequestInit) {
    onNotice(null);
    setBusy(label);
    try {
      const res = await fetch(`/api/social/admin/socks/${s.id}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(token ? { "x-admin-token": token } : {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Request failed (${res.status}).`);
      }
      return data as { sock?: SockDesign };
    } finally {
      setBusy(null);
    }
  }

  async function patch(actionName: "redesign" | "regenerate" | "rerender") {
    try {
      const data = await action(actionName, {
        method: "PATCH",
        body: JSON.stringify({ action: actionName, revisionNote }),
      });
      if (data.sock) onPatch(s.id, data.sock);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    try {
      await action("delete", { method: "DELETE" });
      onRemove(s.id);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <article className="post-card">
      <div className="post-card__head">
        <span className="chip cyan">Sock design</span>
        <span className="chip">{s.orgName}</span>
        {s.colors && <span className="chip">{s.colors}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <figure style={{ margin: 0 }}>
          {s.designUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="post-card__render" src={s.designUrl} alt={`${s.orgName} sock design`} />
          ) : (
            <div className="post-card__placeholder">Mockup not rendered yet.</div>
          )}
          <figcaption style={captionStyle}>Product mockup</figcaption>
        </figure>
        <figure style={{ margin: 0 }}>
          {s.flyerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="post-card__render" src={s.flyerUrl} alt={`${s.orgName} sock pitch flyer`} />
          ) : (
            <div className="post-card__placeholder">Flyer not rendered yet.</div>
          )}
          <figcaption style={captionStyle}>Pitch flyer</figcaption>
        </figure>
      </div>

      <p className="post-card__copy">{s.copy}</p>
      {s.hashtags.length > 0 && <p className="post-card__tags">{s.hashtags.join(" ")}</p>}
      {s.cta && <p className="post-card__cta">▸ {s.cta}</p>}

      <label style={revisionLabelStyle}>
        Want something changed? Type it here, then hit Redesign, Redo flyer, or Rewrite pitch.
      </label>
      <textarea
        value={revisionNote}
        onChange={(e) => setRevisionNote(e.target.value)}
        placeholder="e.g. Bolder stripes, logo higher on the cuff, navy instead of black…"
        rows={2}
        style={revisionBoxStyle}
      />

      <div className="post-card__actions">
        {s.designUrl && (
          <a className="act act--primary" href={s.designUrl} target="_blank" rel="noreferrer" download>
            Download mockup
          </a>
        )}
        {s.flyerUrl && (
          <a className="act act--primary" href={s.flyerUrl} target="_blank" rel="noreferrer" download>
            Download flyer
          </a>
        )}
        <button
          className="act"
          disabled={busy !== null}
          title="Fresh sock mockup, then rebuild the flyer"
          onClick={() => patch("redesign")}
        >
          {busy === "redesign" ? "Designing…" : "Redesign socks"}
        </button>
        <button
          className="act"
          disabled={busy !== null}
          title="Keep the mockup, rebuild the flyer"
          onClick={() => patch("rerender")}
        >
          {busy === "rerender" ? "Rendering…" : "Redo flyer"}
        </button>
        <button
          className="act"
          disabled={busy !== null}
          title="Fresh pitch copy + rebuilt flyer (keep the mockup)"
          onClick={() => patch("regenerate")}
        >
          {busy === "regenerate" ? "Rewriting…" : "Rewrite pitch"}
        </button>
        <button className="act" disabled={busy !== null} onClick={remove}>
          {busy === "delete" ? "…" : "Delete"}
        </button>
      </div>
    </article>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.split(",")[1] ?? ""); // strip the data: prefix
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const inputStyle: React.CSSProperties = {
  background: "var(--tilt-dark-gray)",
  border: "1px solid var(--tilt-mid-gray)",
  borderRadius: 8,
  color: "var(--tilt-text)",
  padding: "8px 12px",
  fontSize: "0.9rem",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.78rem",
  color: "var(--tilt-muted)",
};

const captionStyle: React.CSSProperties = {
  fontSize: "0.72rem",
  color: "var(--tilt-muted)",
  textAlign: "center",
  marginTop: 4,
};

const revisionLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.72rem",
  color: "var(--tilt-muted)",
  margin: "10px 0 4px",
};

const revisionBoxStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--tilt-dark-gray)",
  border: "1px solid var(--tilt-mid-gray)",
  borderRadius: 8,
  color: "var(--tilt-text)",
  padding: "8px 12px",
  fontSize: "0.85rem",
  resize: "vertical",
  fontFamily: "inherit",
  marginBottom: 10,
};

const formCardStyle: React.CSSProperties = {
  border: "1px solid var(--tilt-mid-gray)",
  background: "var(--tilt-dark-gray)",
  borderRadius: 12,
  padding: 16,
  marginTop: 16,
};
