"use client";

import { useMemo, useState } from "react";
import type { Gap } from "@/lib/social/db/schema";
import { useAdminToken } from "@/components/social/useAdminToken";

type Filter = "open" | "shot" | "dismissed" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "shot", label: "Shot" },
  { key: "dismissed", label: "Dismissed" },
  { key: "all", label: "All" },
];

export default function GapsBoard({
  initialGaps,
  demo,
  adminProtected,
}: {
  initialGaps: Gap[];
  demo: boolean;
  adminProtected: boolean;
}) {
  const [gaps, setGaps] = useState<Gap[]>(initialGaps);
  const [filter, setFilter] = useState<Filter>("open");
  const { token, setToken } = useAdminToken();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const g of gaps) c[g.status] = (c[g.status] ?? 0) + 1;
    return c;
  }, [gaps]);

  const visible = filter === "all" ? gaps : gaps.filter((g) => g.status === filter);

  async function setStatus(id: string, status: Gap["status"]) {
    const prev = gaps.find((g) => g.id === id)?.status;
    setNotice(null);
    setBusy(`${id}:${status}`);
    setGaps((gs) => gs.map((g) => (g.id === id ? { ...g, status } : g))); // optimistic
    try {
      const res = await fetch(`/api/social/admin/gaps/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, token: token || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Request failed (${res.status}).`);
      }
    } catch (e) {
      if (prev) setGaps((gs) => gs.map((g) => (g.id === id ? { ...g, status: prev } : g)));
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container">
      <p className="tagline">First-class deliverable</p>
      <h1>Gap Report — Shot List</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 680 }}>
        What the plan needed but the library lacks. This is your next shoot list.
        Mark an item <strong>Shot</strong> once you&apos;ve captured it, or dismiss
        what you won&apos;t chase.
      </p>

      {adminProtected && (
        <div style={{ margin: "14px 0 4px" }}>
          <label style={{ fontSize: "0.78rem", color: "var(--tilt-muted)" }}>
            Admin token (required to save)
          </label>
          <br />
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ADMIN_TOKEN"
            style={tokenInputStyle}
          />
        </div>
      )}

      {demo && (
        <div className="preview-note">
          Preview mode — actions work so you can try the flow, but changes aren&apos;t
          saved.
        </div>
      )}

      {notice && (
        <div className="action-error" role="status">
          {notice}
        </div>
      )}

      {gaps.length === 0 ? (
        <div className="empty">
          <p>No gaps yet.</p>
          <p>Generate the plan and gaps surface here as the founder&apos;s shot list.</p>
        </div>
      ) : (
        <>
          <div className="filters" style={{ marginTop: 18 }}>
            {FILTERS.map((f) => {
              const n = f.key === "all" ? gaps.length : counts[f.key] ?? 0;
              return (
                <button
                  key={f.key}
                  className={`filter-pill${filter === f.key ? " filter-pill--active" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label} <span className="filter-pill__count">{n}</span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <p>{filter === "open" ? "No open gaps 🎉" : "Nothing in this view."}</p>
              {filter === "open" && <p>The plan is fully covered by the current library.</p>}
            </div>
          ) : (
            <div className="gap-list">
              {visible.map((g) => (
                <div className="gap-card" key={g.id}>
                  <div className="gap-card__week">Week of {formatWeek(g.weekStart)}</div>
                  <p className="gap-card__desc">{g.neededAssetDescription}</p>
                  <span className={`status status--gap-${g.status}`}>{g.status}</span>
                  <div className="post-card__actions" style={{ marginTop: 4 }}>
                    {g.status !== "shot" && (
                      <button
                        className="act act--primary"
                        disabled={busy !== null}
                        onClick={() => setStatus(g.id, "shot")}
                      >
                        {busy === `${g.id}:shot` ? "…" : "Mark shot"}
                      </button>
                    )}
                    {g.status !== "dismissed" && (
                      <button
                        className="act"
                        disabled={busy !== null}
                        onClick={() => setStatus(g.id, "dismissed")}
                      >
                        {busy === `${g.id}:dismissed` ? "…" : "Dismiss"}
                      </button>
                    )}
                    {g.status !== "open" && (
                      <button
                        className="act"
                        disabled={busy !== null}
                        onClick={() => setStatus(g.id, "open")}
                      >
                        {busy === `${g.id}:open` ? "…" : "Reopen"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatWeek(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const tokenInputStyle: React.CSSProperties = {
  background: "var(--tilt-black)",
  border: "1px solid var(--tilt-mid-gray)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--tilt-text)",
  width: 280,
  marginTop: 6,
};
