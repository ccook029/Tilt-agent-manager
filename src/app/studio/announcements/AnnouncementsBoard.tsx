"use client";

import { useState } from "react";
import type { Announcement } from "@/lib/social/db/schema";
import { useAdminToken } from "@/components/social/useAdminToken";

/**
 * Announcements workspace: feed the agent a partner name + logo (or an
 * ambassador name/team + real photo) and it writes the uniform caption and
 * builds the branded 4:5 graphic. Everything is reviewable: regenerate the
 * wording, redo the graphic, download the image, delete the draft.
 */
export default function AnnouncementsBoard({
  initial,
  demo,
  adminProtected,
  loadError,
}: {
  initial: Announcement[];
  demo: boolean;
  adminProtected: boolean;
  loadError: string | null;
}) {
  const [items, setItems] = useState<Announcement[]>(initial);
  const { token, setToken } = useAdminToken();
  const [notice, setNotice] = useState<string | null>(null);

  // Form state
  const [kind, setKind] = useState<"partner" | "ambassador">("partner");
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [website, setWebsite] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!name.trim()) {
      setNotice("Give the announcement a name first.");
      return;
    }
    if (!file) {
      setNotice(kind === "partner" ? "Upload the partner's logo (PNG)." : "Upload the player's photo.");
      return;
    }
    setNotice(null);
    setBusy(true);
    try {
      const sourceBase64 = await fileToBase64(file);
      const res = await fetch("/api/social/admin/announcements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          name: name.trim(),
          subtitle: subtitle.trim() || undefined,
          website: kind === "partner" ? website.trim() || undefined : undefined,
          accentColor: kind === "partner" ? accentColor.trim() || undefined : undefined,
          sourceBase64,
          sourceMime: file.type || "image/png",
          token: token || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Generate failed (${res.status}).`);
      }
      setItems((prev) => [data.announcement, ...prev]);
      setName("");
      setSubtitle("");
      setWebsite("");
      setAccentColor("");
      setFile(null);
      setNotice("Announcement generated — review the caption and graphic below.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function patchLocal(id: string, fields: Partial<Announcement>) {
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, ...fields } : a)));
  }

  function removeLocal(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="container">
      <p className="tagline">One-off posts · outside the plan</p>
      <h1>Announcements</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 680 }}>
        Uniform posts for new partnerships and ambassadors. Give it the name and
        the logo (or player photo) — the agent writes the caption + tags and
        builds the branded graphic. Partnership graphics are built entirely in
        code (instant, no image credits) in 4:5, 1:1, and story sizes; logos are
        never AI-drawn.
      </p>

      {demo && (
        <div className="preview-note">
          Preview mode — generating announcements needs a database plus the
          Claude, Gemini, and Blob keys in Vercel.
        </div>
      )}
      {loadError && (
        <div className="action-error" role="status">
          Couldn&apos;t load announcements: {loadError}
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

      {/* New announcement form */}
      <div style={formCardStyle}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            className={`filter-pill${kind === "partner" ? " filter-pill--active" : ""}`}
            onClick={() => setKind("partner")}
          >
            Partnership
          </button>
          <button
            className={`filter-pill${kind === "ambassador" ? " filter-pill--active" : ""}`}
            onClick={() => setKind("ambassador")}
          >
            Ambassador
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "partner" ? "Partner name (e.g. Flex Hockey)" : "Player name (e.g. Logan Arnold)"}
            style={{ ...inputStyle, flex: "1 1 220px" }}
          />
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder={kind === "partner" ? "Tagline (optional)" : "Team (e.g. Hamilton Ironmen)"}
            style={{ ...inputStyle, flex: "1 1 220px" }}
          />
        </div>

        {kind === "partner" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="Website (optional, e.g. pkelite.ca)"
              style={{ ...inputStyle, flex: "1 1 220px" }}
            />
            <input
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              placeholder="Partner accent colour (optional hex, e.g. #00A7E1)"
              style={{ ...inputStyle, flex: "1 1 220px" }}
            />
          </div>
        )}

        <div style={{ margin: "12px 0" }}>
          <label style={{ fontSize: "0.78rem", color: "var(--tilt-muted)" }}>
            {kind === "partner"
              ? "Partner logo — PNG with a transparent background works best"
              : "Player photo — a real shoot photo, portrait works best"}
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
          {busy ? "Generating… (a minute or two)" : "Generate announcement"}
        </button>
      </div>

      {notice && (
        <div className="action-error" role="status">
          {notice}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <p>No announcements yet.</p>
          <p>Generate the first one above — partnership or ambassador.</p>
        </div>
      ) : (
        <div className="post-grid" style={{ marginTop: 24 }}>
          {items.map((a) => (
            <AnnouncementCard
              key={a.id}
              a={a}
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

function AnnouncementCard({
  a,
  token,
  onPatch,
  onRemove,
  onNotice,
}: {
  a: Announcement;
  token: string;
  onPatch: (id: string, fields: Partial<Announcement>) => void;
  onRemove: (id: string) => void;
  onNotice: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  // Partner logo placement — re-composited in code, so applying is instant.
  const [logoPosition, setLogoPosition] = useState(a.logoPosition ?? "center");
  const [logoScale, setLogoScale] = useState(a.logoScale ?? "md");
  const [lockup, setLockup] = useState(a.lockup ?? false);
  const [website, setWebsite] = useState(a.website ?? "");
  const [accentColor, setAccentColor] = useState(a.accentColor ?? "");
  const layoutDirty =
    logoPosition !== (a.logoPosition ?? "center") ||
    logoScale !== (a.logoScale ?? "md") ||
    lockup !== (a.lockup ?? false) ||
    website !== (a.website ?? "") ||
    accentColor !== (a.accentColor ?? "");

  async function action(label: string, init: RequestInit) {
    onNotice(null);
    setBusy(label);
    try {
      const res = await fetch(`/api/social/admin/announcements/${a.id}`, {
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
      return data as { announcement?: Announcement };
    } finally {
      setBusy(null);
    }
  }

  async function regenerate(keepCopy: boolean) {
    try {
      const data = await action(keepCopy ? "rerender" : "regenerate", {
        method: "PATCH",
        body: JSON.stringify({ action: keepCopy ? "rerender" : "regenerate" }),
      });
      if (data.announcement) onPatch(a.id, data.announcement);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    try {
      await action("delete", { method: "DELETE" });
      onRemove(a.id);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function applyLayout() {
    try {
      const data = await action("layout", {
        method: "PATCH",
        body: JSON.stringify({
          action: "layout",
          logoPosition,
          logoScale,
          lockup,
          website: website.trim(),
          accentColor: accentColor.trim(),
        }),
      });
      if (data.announcement) onPatch(a.id, data.announcement);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <article className="post-card">
      <div className="post-card__head">
        <span className="chip cyan">{a.kind === "partner" ? "Partnership" : "Ambassador"}</span>
        <span className="chip">{a.name}</span>
        {a.subtitle && <span className="chip">{a.subtitle}</span>}
      </div>

      {a.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="post-card__render" src={a.imageUrl} alt={`${a.name} announcement`} />
      ) : (
        <div className="post-card__placeholder">Graphic not rendered yet — hit Redo graphic.</div>
      )}

      <p className="post-card__copy">{a.copy}</p>
      {a.hashtags.length > 0 && <p className="post-card__tags">{a.hashtags.join(" ")}</p>}
      {a.cta && <p className="post-card__cta">▸ {a.cta}</p>}

      {a.kind === "partner" && (
        <div style={layoutRowStyle}>
          <select
            value={logoPosition}
            onChange={(e) => setLogoPosition(e.target.value)}
            style={selectStyle}
            aria-label="Logo position"
          >
            <option value="left">Logo left</option>
            <option value="center">Logo center</option>
            <option value="right">Logo right</option>
          </select>
          <select
            value={logoScale}
            onChange={(e) => setLogoScale(e.target.value)}
            style={selectStyle}
            aria-label="Logo size"
          >
            <option value="sm">Small</option>
            <option value="md">Medium</option>
            <option value="lg">Large</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem" }}>
            <input type="checkbox" checked={lockup} onChange={(e) => setLockup(e.target.checked)} />
            × TILT lockup
          </label>
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="Website (optional)"
            style={{ ...selectStyle, width: 150 }}
          />
          <input
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            placeholder="#hex (optional)"
            style={{ ...selectStyle, width: 110 }}
          />
          <button
            className="act act--primary"
            disabled={busy !== null || !layoutDirty}
            title="Re-composite the graphic with these settings (instant — no AI)"
            onClick={applyLayout}
          >
            {busy === "layout" ? "Applying…" : "Apply layout"}
          </button>
        </div>
      )}

      <div className="post-card__actions">
        {a.imageUrl && (
          <a className="act act--primary" href={a.imageUrl} target="_blank" rel="noreferrer" download>
            Download 4:5
          </a>
        )}
        {a.imageUrlSquare && (
          <a className="act" href={a.imageUrlSquare} target="_blank" rel="noreferrer" download>
            1:1
          </a>
        )}
        {a.imageUrlStory && (
          <a className="act" href={a.imageUrlStory} target="_blank" rel="noreferrer" download>
            Story 9:16
          </a>
        )}
        <button
          className="act"
          disabled={busy !== null}
          title="Keep the caption, rebuild the graphic"
          onClick={() => regenerate(true)}
        >
          {busy === "rerender" ? "Rendering…" : "Redo graphic"}
        </button>
        <button
          className="act"
          disabled={busy !== null}
          title="Fresh caption AND a fresh graphic"
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

const formCardStyle: React.CSSProperties = {
  border: "1px solid var(--tilt-mid-gray)",
  background: "var(--tilt-dark-gray)",
  borderRadius: 12,
  padding: 16,
  marginTop: 16,
};

const layoutRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  margin: "10px 0 2px",
  color: "var(--tilt-muted)",
};

const selectStyle: React.CSSProperties = {
  background: "var(--tilt-dark-gray)",
  border: "1px solid var(--tilt-mid-gray)",
  borderRadius: 8,
  color: "var(--tilt-text)",
  padding: "6px 8px",
  fontSize: "0.8rem",
};
