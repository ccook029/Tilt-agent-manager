import Link from "next/link";
import { listPosts } from "@/lib/social/queries";
import type { Post } from "@/lib/social/db/schema";

export const dynamic = "force-dynamic";

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

export default async function PostsPage() {
  let posts: Post[] = [];
  let error: string | null = null;
  try {
    posts = await listPosts();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const byDate = groupByDate(posts);

  return (
    <div className="container">
      <p className="tagline">Locked window · next 14 days</p>
      <h1>Posts</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 680 }}>
        Finished, review-ready posts with platform-specific copy. Each is tagged
        with its pillar, the matched asset or render brief, and a status. Approve,
        edit, and regenerate land in the portal phase.
      </p>

      {error ? (
        <div className="empty">
          <p>Couldn&apos;t load posts.</p>
          <p style={{ fontSize: "0.8rem" }}>{error}</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="empty">
          <p>No posts yet.</p>
          <p>
            Generate the plan from{" "}
            <Link href="/studio/social/setup">Setup</Link> (needs a database +
            Claude key) to write the locked window.
          </p>
        </div>
      ) : (
        Object.entries(byDate).map(([date, dayPosts]) => (
          <section key={date} style={{ marginTop: 26 }}>
            <h2 style={{ fontSize: "1rem", color: "var(--tilt-cyan)" }}>
              {formatDate(date)}
            </h2>
            <div className="post-grid">
              {dayPosts.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function PostCard({ post }: { post: Post }) {
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
      {post.renderUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="post-card__render" src={post.renderUrl} alt="Rendered visual" />
      )}
      <p className="post-card__copy">{post.copy}</p>
      {post.hashtags.length > 0 && (
        <p className="post-card__tags">{post.hashtags.join(" ")}</p>
      )}
      {post.cta && <p className="post-card__cta">▸ {post.cta}</p>}
      {(post.renderKind || post.editBrief) && (
        <div className="post-card__brief">
          {post.renderKind && (
            <span className={`render render--${post.renderKind}`}>
              {renderLabel(post.renderKind)}
            </span>
          )}
          {post.editBrief && <span>{post.editBrief}</span>}
        </div>
      )}
    </article>
  );
}

function renderLabel(kind: string): string {
  return kind === "nano"
    ? "Static (Nano Banana)"
    : kind === "shotstack"
      ? "Auto reel (Shotstack)"
      : "Manual edit";
}

function groupByDate(posts: Post[]): Record<string, Post[]> {
  const out: Record<string, Post[]> = {};
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
