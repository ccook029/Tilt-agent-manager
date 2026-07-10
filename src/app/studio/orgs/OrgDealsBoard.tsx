"use client";

import { useState } from "react";
import type { OrgStickDeal } from "@/lib/social/db/schema";
import { useAdminToken } from "@/components/social/useAdminToken";

/**
 * Org Stick Programs workspace: give it the organization's name, crest, terms
 * (member discount / club kickback), order deadline and the club's private
 * tiltweb ordering link — the agent generates the whole pitch package:
 *
 *   · the org-facing pitch one-pager PDF (all terms + the MAP note),
 *   · the member email (full detail incl. the discount — email is MAP-safe),
 *   · the PUBLIC social caption + graphics with zero pricing on them.
 *
 * Everything is reviewable: regenerate the wording, redo the visuals, download
 * each piece, delete the draft. Org crest + TILT wordmark are composited by
 * code, never AI-drawn.
 */
export default function OrgDealsBoard({
  initial,
  demo,
  adminProtected,
  loadError,
}: {
  initial: OrgStickDeal[];
  demo: boolean;
  adminProtected: boolean;
  loadError: string | null;
}) {
  const [items, setItems] = useState<OrgStickDeal[]>(initial);
  const { token, setToken } = useAdminToken();
  const [notice, setNotice] = useState<string | null>(null);

  // Form state
  const [orgName, setOrgName] = useState("");
  const [contactName, setContactName] = useState("");
  const [orderUrl, setOrderUrl] = useState("");
  const [deadline, setDeadline] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [discountPct, setDiscountPct] = useState("15");
  const [kickbackPct, setKickbackPct] = useState("10");
  const [accentColor, setAccentColor] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!orgName.trim()) {
      setNotice("Add the organization name first.");
      return;
    }
    if (!deadline) {
      setNotice("Pick the order deadline.");
      return;
    }
    if (!file) {
      setNotice("Upload the organization's logo/crest.");
      return;
    }
    setNotice(null);
    setBusy(true);
    try {
      const logoBase64 = await fileToBase64(file);
      const res = await fetch("/api/social/admin/orgdeals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgName: orgName.trim(),
          contactName: contactName.trim() || undefined,
          orderUrl: orderUrl.trim() || undefined,
          deadline,
          deliveryDate: deliveryDate || undefined,
          discountPct: Number(discountPct) || 15,
          kickbackPct: Number(kickbackPct) || 10,
          accentColor: accentColor.trim() || undefined,
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
      setItems((prev) => [data.orgDeal, ...prev]);
      setOrgName("");
      setContactName("");
      setOrderUrl("");
      setDeadline("");
      setDeliveryDate("");
      setDiscountPct("15");
      setKickbackPct("10");
      setAccentColor("");
      setNote("");
      setFile(null);
      setNotice("Program package generated — review the pitch, email, and post below.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function patchLocal(id: string, fields: Partial<OrgStickDeal>) {
    setItems((prev) => prev.map((d) => (d.id === id ? { ...d, ...fields } : d)));
  }

  function removeLocal(id: string) {
    setItems((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <div className="container">
      <p className="tagline">Organization pitches · group stick programs</p>
      <h1>Org Stick Programs</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 720 }}>
        The full pitch package for an organization stick deal (Lucan Irish
        style): members get a discount on a private club ordering page, the
        whole batch ships to the club, and the club earns a kickback on net
        sales. One generate builds the <strong>org pitch PDF</strong> (all
        terms + the MAP note), the <strong>member email</strong> (discount
        included — email is the MAP-safe channel), and the{" "}
        <strong>public social post + graphics</strong> with zero pricing on
        them. Crest and TILT wordmark are composited by code, never AI-drawn.
      </p>

      {demo && (
        <div className="preview-note">
          Preview mode — generating org programs needs a database plus the
          Claude and Blob keys in Vercel.
        </div>
      )}
      {loadError && (
        <div className="action-error" role="status">
          Couldn&apos;t load org programs: {loadError}
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

      {/* New program form */}
      <div style={formCardStyle}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Organization name (e.g. Lucan Irish)"
            style={{ ...inputStyle, flex: "1 1 240px" }}
          />
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Contact (e.g. Sean, Club President)"
            style={{ ...inputStyle, flex: "1 1 240px" }}
          />
        </div>

        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}>
            Private ordering link — create the program in tiltweb admin first
            (/admin/org-deals), then paste its /org/&lt;slug&gt; link here
          </label>
          <br />
          <input
            value={orderUrl}
            onChange={(e) => setOrderUrl(e.target.value)}
            placeholder="https://tilthockey.com/org/lucan-irish"
            style={{ ...inputStyle, width: "100%", marginTop: 6 }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <div style={{ flex: "1 1 160px" }}>
            <label style={labelStyle}>Order deadline</label>
            <br />
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              style={{ ...inputStyle, width: "100%", marginTop: 6 }}
            />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <label style={labelStyle}>Club delivery (blank = +6 weeks)</label>
            <br />
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              style={{ ...inputStyle, width: "100%", marginTop: 6 }}
            />
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <label style={labelStyle}>Member discount %</label>
            <br />
            <input
              type="number"
              min={1}
              max={100}
              value={discountPct}
              onChange={(e) => setDiscountPct(e.target.value)}
              style={{ ...inputStyle, width: "100%", marginTop: 6 }}
            />
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <label style={labelStyle}>Club kickback %</label>
            <br />
            <input
              type="number"
              min={0}
              max={100}
              value={kickbackPct}
              onChange={(e) => setKickbackPct(e.target.value)}
              style={{ ...inputStyle, width: "100%", marginTop: 6 }}
            />
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <label style={labelStyle}>Accent hex (optional)</label>
            <br />
            <input
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              placeholder="#00A651"
              style={{ ...inputStyle, width: "100%", marginTop: 6 }}
            />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}>Short note (optional)</label>
          <br />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything to fold into the pitch/email/post (club history, tournament dates, etc.)"
            rows={2}
            style={{ ...inputStyle, width: "100%", marginTop: 6, resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <div style={{ margin: "12px 0" }}>
          <label style={labelStyle}>
            Organization logo / crest (PNG with transparency works best)
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
          {busy ? "Generating the package… (a minute or two)" : "Generate program package"}
        </button>
      </div>

      {notice && (
        <div className="action-error" role="status">
          {notice}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <p>No org programs yet.</p>
          <p>Generate the first one above — Lucan Irish is waiting.</p>
        </div>
      ) : (
        <div className="post-grid" style={{ marginTop: 24 }}>
          {items.map((d) => (
            <OrgDealCard
              key={d.id}
              d={d}
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

function OrgDealCard({
  d,
  token,
  onPatch,
  onRemove,
  onNotice,
}: {
  d: OrgStickDeal;
  token: string;
  onPatch: (id: string, fields: Partial<OrgStickDeal>) => void;
  onRemove: (id: string) => void;
  onNotice: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState(d.revisionNote ?? "");
  const [copied, setCopied] = useState<string | null>(null);

  async function action(label: string, init: RequestInit) {
    onNotice(null);
    setBusy(label);
    try {
      const res = await fetch(`/api/social/admin/orgdeals/${d.id}`, {
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
      return data as { orgDeal?: OrgStickDeal };
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
      if (data.orgDeal) onPatch(d.id, data.orgDeal);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    try {
      await action("delete", { method: "DELETE" });
      onRemove(d.id);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  function copyText(label: string, text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => onNotice("Couldn't copy — select and copy manually."));
  }

  const emailFull = [d.emailSubject ? `Subject: ${d.emailSubject}` : "", d.emailBody ?? ""]
    .filter(Boolean)
    .join("\n\n");

  return (
    <article className="post-card">
      <div className="post-card__head">
        <span className="chip cyan">Org Program</span>
        <span className="chip">{d.orgName}</span>
        <span className="chip">Closes {formatDeadline(d.deadline)}</span>
        <span className="chip">
          {d.discountPct}% / {d.kickbackPct}%
        </span>
      </div>

      {d.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="post-card__render" src={d.imageUrl} alt={`${d.orgName} stick program graphic`} />
      ) : (
        <div className="post-card__placeholder">Graphics not rendered yet — hit Redo visuals.</div>
      )}

      {/* Public post (MAP-safe) */}
      <p style={sectionHead}>Public post — MAP-safe, no pricing</p>
      <p className="post-card__copy">{d.copy}</p>
      {d.hashtags.length > 0 && <p className="post-card__tags">{d.hashtags.join(" ")}</p>}
      {d.cta && <p className="post-card__cta">▸ {d.cta}</p>}

      {/* Member email (full detail) */}
      {d.emailBody && (
        <>
          <p style={sectionHead}>
            Member email — full detail, send via the club (never post publicly)
          </p>
          <div style={emailBoxStyle}>
            {d.emailSubject && (
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Subject: {d.emailSubject}</p>
            )}
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{d.emailBody}</p>
          </div>
          <button className="act" onClick={() => copyText("email", emailFull)}>
            {copied === "email" ? "Copied ✓" : "Copy email"}
          </button>
        </>
      )}

      <label style={revisionLabelStyle}>
        Want something changed? Type it here, then hit Redo visuals or Regenerate all.
      </label>
      <textarea
        value={revisionNote}
        onChange={(e) => setRevisionNote(e.target.value)}
        placeholder="e.g. Lead the email with the deadline, warmer pitch intro, bigger crest…"
        rows={2}
        style={revisionBoxStyle}
      />

      <div className="post-card__actions">
        {d.pitchPdfUrl && (
          <a className="act act--primary" href={d.pitchPdfUrl} target="_blank" rel="noreferrer">
            Org pitch PDF
          </a>
        )}
        {d.imageUrl && (
          <a className="act" href={d.imageUrl} target="_blank" rel="noreferrer" download>
            4:5
          </a>
        )}
        {d.imageUrlSquare && (
          <a className="act" href={d.imageUrlSquare} target="_blank" rel="noreferrer" download>
            1:1
          </a>
        )}
        {d.imageUrlStory && (
          <a className="act" href={d.imageUrlStory} target="_blank" rel="noreferrer" download>
            9:16
          </a>
        )}
        <button
          className="act"
          disabled={busy !== null}
          title="Keep the wording, rebuild the graphics + pitch PDF"
          onClick={() => regenerate(true)}
        >
          {busy === "rerender" ? "Rendering…" : "Redo visuals"}
        </button>
        <button
          className="act"
          disabled={busy !== null}
          title="Fresh pitch, email, and post AND fresh renders"
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

/** Friendly long-form date, e.g. "September 30th". Mirrors the server formatter. */
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

const sectionHead: React.CSSProperties = {
  margin: "12px 0 4px",
  fontSize: "0.72rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--tilt-muted)",
};

const emailBoxStyle: React.CSSProperties = {
  background: "var(--tilt-dark-gray)",
  border: "1px solid var(--tilt-mid-gray)",
  borderRadius: 8,
  color: "var(--tilt-text)",
  padding: "10px 12px",
  fontSize: "0.82rem",
  marginBottom: 8,
  maxHeight: 220,
  overflowY: "auto",
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
