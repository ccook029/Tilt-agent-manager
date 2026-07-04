"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Post } from "@/lib/social/db/schema";
import type { PostWithAsset } from "@/lib/social/queries";
import { needsRender } from "@/lib/social/render/version";
import { useAdminToken } from "@/components/social/useAdminToken";

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

type Filter = "all" | "needs_review" | "approved" | "published";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs review" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
];

export default function PostsBoard({
  initialPosts,
  demo,
  adminProtected,
  videoConfigured,
}: {
  initialPosts: PostWithAsset[];
  demo: boolean;
  adminProtected: boolean;
  /** Whether SHOTSTACK_API_KEY is set server-side (reel cuts can render). */
  videoConfigured: boolean;
}) {
  const [posts, setPosts] = useState<PostWithAsset[]>(initialPosts);
  const [filter, setFilter] = useState<Filter>("all");
  const { token, setToken } = useAdminToken();
  const [notice, setNotice] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  // Per-post failures from the last render run, keyed by post id.
  const [renderErrors, setRenderErrors] = useState<Record<string, string>>({});

  // Posts missing an image, or carrying one made with outdated branding.
  const pendingRenders = useMemo(() => posts.filter(needsRender).length, [posts]);
  const renderable = useMemo(
    () =>
      posts.filter(
        (p) =>
          p.assetId &&
          (p.renderKind === "nano" || p.renderKind === "shotstack"),
      ).length,
    [posts],
  );

  // Auto-generate missing images on load. Runs at most once per visit; waits
  // for the saved admin token when one is required.
  const autoRendered = useRef(false);
  useEffect(() => {
    if (autoRendered.current || demo || rendering) return;
    if (pendingRenders === 0) return;
    if (adminProtected && !token) return;
    autoRendered.current = true;
    void generateImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, adminProtected, token, pendingRenders, rendering]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of posts) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [posts]);

  const visible = filter === "all" ? posts : posts.filter((p) => p.status === filter);
  const byDate = groupByDate(visible);

  function patchLocal(id: string, fields: Partial<Post>) {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...fields } : p)));
  }

  /** Calls an admin endpoint with the token; returns parsed JSON or throws. */
  async function call(path: string, method: string, body: Record<string, unknown>) {
    const res = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, token: token || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Request failed (${res.status}).`);
    }
    return data as { ok: true; demo?: boolean; post?: Post };
  }

  /** Runs the static render pipeline and pulls the new images into the board. */
  async function generateImages(force = false) {
    setNotice(null);
    setRendering(true);
    try {
      const res = await fetch("/api/social/admin/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token || undefined, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Render failed (${res.status}).`);
      }
      const results: { postId: string; renderUrl?: string; error?: string }[] =
        data.results ?? [];
      const errs: Record<string, string> = {};
      for (const r of results) {
        if (r.renderUrl) patchLocal(r.postId, { renderUrl: r.renderUrl });
        if (r.error) errs[r.postId] = r.error;
      }
      setRenderErrors(errs);
      // The route summarizes the whole pass (rendered counts + every skip and
      // failure reason), so surface that instead of recomputing a vaguer one.
      if (typeof data.message === "string" && data.message) {
        setNotice(`Render pass: ${data.message}.`);
      } else {
        const rendered = results.filter((r) => r.renderUrl).length;
        const failed = results.filter((r) => r.error).length;
        setNotice(
          `Generated ${rendered} image${rendered === 1 ? "" : "s"}.` +
            (failed ? ` ${failed} failed — details on the affected cards.` : ""),
        );
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="container">
      <p className="tagline">Locked window · next 14 days</p>
      <h1>Posts</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 680 }}>
        Finished, review-ready posts with platform-specific copy. Approve what&apos;s
        ready, edit the copy inline, or regenerate a card to have the brain rewrite
        it. Nothing publishes without your sign-off.
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
          saved. Connect a database to make review permanent.
        </div>
      )}

      {notice && (
        <div className="action-error" role="status">
          {notice}
        </div>
      )}

      {posts.length === 0 ? (
        <div className="empty">
          <p>No posts yet.</p>
          <p>
            Run <code>npm run plan:generate</code> (needs a database + Claude key)
            or use <strong>Generate plan</strong> on the Setup page.
          </p>
        </div>
      ) : (
        <>
          <div className="filters" style={{ marginTop: 18 }}>
            {FILTERS.map((f) => {
              const n = f.key === "all" ? posts.length : counts[f.key] ?? 0;
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
            <button
              className={`act${pendingRenders > 0 ? " act--primary" : ""}`}
              style={{ marginLeft: "auto" }}
              disabled={rendering || demo || renderable === 0}
              title={
                demo
                  ? "Preview mode — connect a database + Gemini key to render"
                  : renderable === 0
                    ? "No renderable posts"
                    : pendingRenders === 0
                      ? "Redo every visual with the current brand treatment + logo"
                      : "Render the visuals (statics + reels) for posts that don't have one yet"
              }
              onClick={() => generateImages(pendingRenders === 0)}
            >
              {rendering
                ? "Generating visuals… (a few minutes)"
                : pendingRenders > 0
                  ? `Generate visuals (${pendingRenders})`
                  : `Re-render visuals (${renderable})`}
            </button>
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <p>Nothing in this view.</p>
            </div>
          ) : (
            Object.entries(byDate).map(([date, dayPosts]) => (
              <section key={date} style={{ marginTop: 26 }}>
                <h2 style={{ fontSize: "1rem", color: "var(--tilt-cyan)" }}>
                  {formatDate(date)}
                </h2>
                <div className="post-grid">
                  {dayPosts.map((p) => (
                    <PostCard
                      key={p.id}
                      post={p}
                      demo={demo}
                      videoConfigured={videoConfigured}
                      renderError={renderErrors[p.id]}
                      onPatchLocal={patchLocal}
                      call={call}
                      onNotice={setNotice}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

function PostCard({
  post,
  demo,
  videoConfigured,
  renderError,
  onPatchLocal,
  call,
  onNotice,
}: {
  post: PostWithAsset;
  demo: boolean;
  videoConfigured: boolean;
  renderError?: string;
  onPatchLocal: (id: string, fields: Partial<Post>) => void;
  call: (path: string, method: string, body: Record<string, unknown>) => Promise<{ ok: true; demo?: boolean; post?: Post }>;
  onNotice: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftCopy, setDraftCopy] = useState(post.copy ?? "");
  const [draftTags, setDraftTags] = useState(post.hashtags.join(" "));
  const [draftCta, setDraftCta] = useState(post.cta ?? "");

  async function run(label: string, fn: () => Promise<void>) {
    onNotice(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function setStatus(status: Post["status"], action: "approve" | "needs_review") {
    return run(action, async () => {
      const prev = post.status;
      onPatchLocal(post.id, { status }); // optimistic
      try {
        const r = await call(`/api/social/admin/posts/${post.id}`, "PATCH", { action });
        if (r.post) onPatchLocal(post.id, r.post);
      } catch (e) {
        onPatchLocal(post.id, { status: prev }); // revert
        throw e;
      }
    });
  }

  function saveEdit() {
    return run("save", async () => {
      const hashtags = draftTags
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const r = await call(`/api/social/admin/posts/${post.id}`, "PATCH", {
        copy: draftCopy,
        hashtags,
        cta: draftCta,
      });
      onPatchLocal(post.id, r.post ?? { copy: draftCopy, hashtags, cta: draftCta, status: "needs_review" });
      setEditing(false);
    });
  }

  function regenerate() {
    return run("regenerate", async () => {
      const r = await call(`/api/social/admin/posts/${post.id}/regenerate`, "POST", {});
      if (r.post) {
        onPatchLocal(post.id, r.post);
        setDraftCopy(r.post.copy ?? "");
        setDraftTags(r.post.hashtags.join(" "));
        setDraftCta(r.post.cta ?? "");
      }
    });
  }

  /** Manual-edit video post -> Shotstack auto-cut (copy untouched). */
  function autoCut() {
    return run("auto_cut", async () => {
      const r = await call(`/api/social/admin/posts/${post.id}`, "PATCH", { action: "auto_cut" });
      onPatchLocal(post.id, r.post ?? { renderKind: "shotstack", renderUrl: null });
      onNotice(
        "Switched to the Shotstack auto-cut — it renders on the next visuals pass (reload in a couple of minutes, or use Generate visuals).",
      );
    });
  }

  return (
    <article className="post-card">
      <div className="post-card__head">
        <span className={`platform platform--${post.platform}`}>
          {PLATFORM_LABEL[post.platform] ?? post.platform}
        </span>
        <span className="chip cyan">{post.pillar}</span>
        {post.format && <span className="chip">{post.format}</span>}
        <span className={`status status--${post.status}`}>
          {post.status.replace("_", " ")}
        </span>
      </div>

      {post.renderUrl ? (
        isVideoUrl(post.renderUrl) ? (
          <video
            className="post-card__render"
            src={post.renderUrl}
            controls
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="post-card__render" src={post.renderUrl} alt="Rendered visual" />
        )
      ) : post.assetUrl ? (
        <div className="post-card__visual">
          {post.assetType === "video" ? (
            <video
              className="post-card__render"
              src={post.assetUrl}
              controls
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="post-card__render" src={post.assetUrl} alt="Matched source photo" />
          )}
          <span className="visual-note">
            <strong className="visual-note__flag">Unbranded preview</strong>
            {" · "}
            {unbrandedNote(post, videoConfigured)}
          </span>
          {renderError && (
            <span className="visual-note visual-note--error">Render failed: {renderError}</span>
          )}
        </div>
      ) : (
        <div className="post-card__placeholder">
          {post.assetId
            ? "Visual not rendered yet"
            : "No matched asset — this slot is on the Gaps shot list"}
        </div>
      )}

      {editing ? (
        <div className="post-edit">
          <textarea
            className="post-edit__copy"
            value={draftCopy}
            onChange={(e) => setDraftCopy(e.target.value)}
            rows={6}
          />
          <input
            className="post-edit__input"
            value={draftTags}
            onChange={(e) => setDraftTags(e.target.value)}
            placeholder="#hashtags space-separated"
          />
          <input
            className="post-edit__input"
            value={draftCta}
            onChange={(e) => setDraftCta(e.target.value)}
            placeholder="Call to action"
          />
        </div>
      ) : (
        <>
          <p className="post-card__copy">{post.copy}</p>
          {post.hashtags.length > 0 && (
            <p className="post-card__tags">{post.hashtags.join(" ")}</p>
          )}
          {post.cta && <p className="post-card__cta">▸ {post.cta}</p>}
        </>
      )}

      {(post.renderKind || post.editBrief) && !editing && (
        <div className="post-card__brief">
          {post.renderKind && (
            <span className={`render render--${post.renderKind}`}>
              {renderLabel(post.renderKind)}
            </span>
          )}
          {post.editBrief && <span>{post.editBrief}</span>}
        </div>
      )}

      <div className="post-card__actions">
        {editing ? (
          <>
            <button className="act act--primary" disabled={busy !== null} onClick={saveEdit}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button
              className="act"
              disabled={busy !== null}
              onClick={() => {
                setDraftCopy(post.copy ?? "");
                setDraftTags(post.hashtags.join(" "));
                setDraftCta(post.cta ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {post.status === "approved" ? (
              <button
                className="act"
                disabled={busy !== null}
                onClick={() => setStatus("needs_review", "needs_review")}
              >
                {busy === "needs_review" ? "…" : "Un-approve"}
              </button>
            ) : (
              <button
                className="act act--primary"
                disabled={busy !== null}
                onClick={() => setStatus("approved", "approve")}
              >
                {busy === "approve" ? "…" : "Approve"}
              </button>
            )}
            <button className="act" disabled={busy !== null} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              className="act"
              disabled={busy !== null}
              title={demo ? "Regenerate needs a database + Claude key" : "Rewrite this card with the brain"}
              onClick={regenerate}
            >
              {busy === "regenerate" ? "Rewriting…" : "Regenerate"}
            </button>
            {post.renderKind === "manual" && post.assetType === "video" && (
              <button
                className="act"
                disabled={busy !== null || demo}
                title="Skip the hand edit: switch this clip to the Shotstack auto-cut (keeps the copy)"
                onClick={autoCut}
              >
                {busy === "auto_cut" ? "Switching…" : "Auto-cut instead"}
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/** Why this card is showing raw source media instead of a branded render. */
function unbrandedNote(post: PostWithAsset, videoConfigured: boolean): string {
  if (post.renderKind === "nano" && post.assetType === "video")
    return "this static post got matched to a video, which the photo pipeline can't brand — hit Regenerate to re-pick a photo";
  if (post.renderKind === "shotstack") {
    if (post.assetType !== "video")
      return "this reel slot got matched to a photo, and Shotstack cuts reels from video clips — hit Regenerate to re-pick a clip";
    if (!videoConfigured)
      return "branded reel cut is waiting on the video pipeline — add SHOTSTACK_API_KEY in Vercel and redeploy";
    return "branded reel cut renders on the next visuals pass — reload in a couple of minutes";
  }
  if (post.renderKind === "manual")
    return "earmarked for a manual edit — apply branding by hand, or use Auto-cut instead for an automatic branded reel";
  return "branded render is queued and will appear here automatically";
}

function isVideoUrl(url: string): boolean {
  return url.split("?")[0].toLowerCase().endsWith(".mp4");
}

function renderLabel(kind: string): string {
  return kind === "nano"
    ? "Static (Nano Banana)"
    : kind === "shotstack"
      ? "Auto reel (Shotstack)"
      : "Manual edit";
}

function groupByDate(posts: PostWithAsset[]): Record<string, PostWithAsset[]> {
  const out: Record<string, PostWithAsset[]> = {};
  for (const p of posts) {
    const k = p.scheduledDate ?? "Unscheduled";
    (out[k] ??= []).push(p);
  }
  return out;
}

function formatDate(iso: string): string {
  if (iso === "Unscheduled") return iso;
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
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
