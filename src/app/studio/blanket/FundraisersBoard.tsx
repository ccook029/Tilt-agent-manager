"use client";

import { useState } from "react";
import type { Fundraiser } from "@/lib/social/db/schema";
import { useAdminToken } from "@/components/social/useAdminToken";

const BLANKET_PRICE = 60;

/**
 * Blanket Fundraiser workspace: upload the finished blanket rendering, give the
 * agent the org name, a payment email, a pre-order deadline (date picker) and an
 * optional note — it writes the uniform caption and builds the branded 4:5
 * flyer. Everything is reviewable: regenerate the wording, redo the flyer,
 * download the image, delete the draft. Price is fixed at $60/blanket.
 */
export default function FundraisersBoard({
  initial,
  demo,
  adminProtected,
  loadError,
}: {
  initial: Fundraiser[];
  demo: boolean;
  adminProtected: boolean;
  loadError: string | null;
}) {
  const [items, setItems] = useState<Fundraiser[]>(initial);
  const { token, setToken } = useAdminToken();
  const [notice, setNotice] = useState<string | null>(null);

  // Form state
  const [orgName, setOrgName] = useState("");
  const [paymentEmail, setPaymentEmail] = useState("");
  const [deadline, setDeadline] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!orgName.trim()) {
      setNotice("Add the organization name first.");
      return;
    }
    if (!deadline) {
      setNotice("Pick a pre-order deadline.");
      return;
    }
    if (!file) {
      setNotice("Upload the blanket image.");
      return;
    }
    setNotice(null);
    setBusy(true);
    try {
      const blanketBase64 = await fileToBase64(file);
      const res = await fetch("/api/social/admin/fundraisers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgName: orgName.trim(),
          paymentEmail: paymentEmail.trim() || undefined,
          deadline,
          note: note.trim() || undefined,
          blanketBase64,
          blanketMime: file.type || "image/png",
          token: token || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Generate failed (${res.status}).`);
      }
      setItems((prev) => [data.fundraiser, ...prev]);
      setOrgName("");
      setPaymentEmail("");
      setDeadline("");
      setNote("");
      setFile(null);
      setNotice("Fundraiser post generated — review the caption and flyer below.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function patchLocal(id: string, fields: Partial<Fundraiser>) {
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, ...fields } : f)));
  }

  function removeLocal(id: string) {
    setItems((prev) => prev.filter((f) => f.id !== id));
  }

  return (
    <div className="container">
      <p className="tagline">Team fundraisers · blanket pre-orders</p>
      <h1>Blanket Fundraisers</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 680 }}>
        Ready-to-post graphics for teams running a Tilt blanket pre-order. Upload
        the blanket design, give it the org name, a payment email, and a deadline —
        the agent writes the caption + tags and builds the branded flyer around the
        real blanket. Price is fixed at <strong>${BLANKET_PRICE}/blanket</strong>.
        The TILT wordmark is composited by code, never AI-drawn.
      </p>

      {demo && (
        <div className="preview-note">
          Preview mode — generating fundraiser posts needs a database plus the
          Claude, Gemini, and Blob keys in Vercel.
        </div>
      )}
      {loadError && (
        <div className="action-error" role="status">
          Couldn&apos;t load fundraisers: {loadError}
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

      {/* New fundraiser form */}
      <div style={formCardStyle}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Organization name (e.g. Jr. Lady Sting)"
            style={{ ...inputStyle, flex: "1 1 240px" }}
          />
          <input
            value={paymentEmail}
            onChange={(e) => setPaymentEmail(e.target.value)}
            placeholder="Payment email (e-transfer)"
            type="email"
            style={{ ...inputStyle, flex: "1 1 240px" }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={labelStyle}>Pre-order deadline</label>
            <br />
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              style={{ ...inputStyle, width: "100%", marginTop: 6 }}
            />
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={labelStyle}>Price per blanket</label>
            <br />
            <input
              value={`$${BLANKET_PRICE}`}
              disabled
              title="Fixed price — set in the app logic"
              style={{ ...inputStyle, width: "100%", marginTop: 6, opacity: 0.7 }}
            />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}>Short note (optional)</label>
          <br />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the org wants worked into the post (pickup details, thanks, etc.)"
            rows={2}
            style={{ ...inputStyle, width: "100%", marginTop: 6, resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <div style={{ margin: "12px 0" }}>
          <label style={labelStyle}>
            Blanket image — the finished Tilt blanket rendering (PNG works best)
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
          {busy ? "Generating… (a minute or two)" : "Generate fundraiser post"}
        </button>
      </div>

      {notice && (
        <div className="action-error" role="status">
          {notice}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <p>No fundraiser posts yet.</p>
          <p>Generate the first one above — upload a blanket and pick a deadline.</p>
        </div>
      ) : (
        <div className="post-grid" style={{ marginTop: 24 }}>
          {items.map((f) => (
            <FundraiserCard
              key={f.id}
              f={f}
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

function FundraiserCard({
  f,
  token,
  onPatch,
  onRemove,
  onNotice,
}: {
  f: Fundraiser;
  token: string;
  onPatch: (id: string, fields: Partial<Fundraiser>) => void;
  onRemove: (id: string) => void;
  onNotice: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState(f.revisionNote ?? "");

  async function action(label: string, init: RequestInit) {
    onNotice(null);
    setBusy(label);
    try {
      const res = await fetch(`/api/social/admin/fundraisers/${f.id}`, {
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
      return data as { fundraiser?: Fundraiser };
    } finally {
      setBusy(null);
    }
  }

  async function regenerate(keepCopy: boolean) {
    try {
      const data = await action(keepCopy ? "rerender" : "regenerate", {
        method: "PATCH",
        body: JSON.stringify({
          action: keepCopy ? "rerender" : "regenerate",
          revisionNote,
        }),
      });
      if (data.fundraiser) onPatch(f.id, data.fundraiser);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    try {
      await action("delete", { method: "DELETE" });
      onRemove(f.id);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <article className="post-card">
      <div className="post-card__head">
        <span className="chip cyan">Fundraiser</span>
        <span className="chip">{f.orgName}</span>
        <span className="chip">Due {formatDeadline(f.deadline)}</span>
      </div>

      {f.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="post-card__render" src={f.imageUrl} alt={`${f.orgName} blanket fundraiser`} />
      ) : (
        <div className="post-card__placeholder">Flyer not rendered yet — hit Redo flyer.</div>
      )}

      <p className="post-card__copy">{f.copy}</p>
      {f.hashtags.length > 0 && <p className="post-card__tags">{f.hashtags.join(" ")}</p>}
      {f.cta && <p className="post-card__cta">▸ {f.cta}</p>}

      <label style={revisionLabelStyle}>
        Want something changed? Type it here, then hit Redo flyer or Regenerate all.
      </label>
      <textarea
        value={revisionNote}
        onChange={(e) => setRevisionNote(e.target.value)}
        placeholder="e.g. Make the price bigger, move the crest up, use a lighter background…"
        rows={2}
        style={revisionBoxStyle}
      />

      <div className="post-card__actions">
        {f.imageUrl && (
          <a className="act act--primary" href={f.imageUrl} target="_blank" rel="noreferrer" download>
            Download image
          </a>
        )}
        <button
          className="act"
          disabled={busy !== null}
          title="Keep the caption, rebuild the flyer"
          onClick={() => regenerate(true)}
        >
          {busy === "rerender" ? "Rendering…" : "Redo flyer"}
        </button>
        <button
          className="act"
          disabled={busy !== null}
          title="Fresh caption AND a fresh flyer"
          onClick={() => regenerate(false)}
        >
          {busy === "regenerate" ? "Rewriting…" : "Regenerate all"}
        </button>
        <button className="act" disabled={busy !== null} onClick={remove}>
          {busy === "delete" ? "…" : "Delete"}
        </button>
      </div>
    </article>
  );
}

/** Friendly long-form date, e.g. "July 31st". Mirrors the server formatter. */
function formatDeadline(deadline: string): string {
  const [y, m, d] = deadline.split("-").map((n) => Number(n));
  if (!y || !m || !d) return deadline;
  const date = new Date(Date.UTC(y, m - 1, d));
  const month = date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const day = date.getUTCDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${month} ${day}${suffix}`;
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
