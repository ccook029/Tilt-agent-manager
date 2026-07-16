// ---------------------------------------------------------------------------
// pipelines/publish.ts — take APPROVED Studio content live
//
// The bridge between the Social Studio's approval gate and the platforms.
// A post reaches status "approved" only after a human signs off (Chris keeps
// the trigger). This pipeline posts those approved pieces to their platform
// via the publisher layer and flips them to "published".
//
// Fully guarded: it does nothing unless the Studio DB is configured AND at
// least one platform is connected — so it's a safe no-op until Chris wires the
// tokens. Only "approved" posts with real media are ever touched.
// ---------------------------------------------------------------------------
import { getPostById, listPosts, updatePostStatus } from "../social/queries";
import { hasDatabase } from "../social/env";
import { anyPlatformConnected, publishRequest } from "../publish";
import { normalizePlatform, type PublishResult } from "../publish/types";
import { postSignal } from "../signals";
import type { Post } from "../social/db/schema";

function captionFor(post: Post): string {
  return [post.copy, (post.hashtags ?? []).join(" "), post.cta]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function mediaTypeFor(post: Post): "photo" | "video" {
  return post.renderKind === "shotstack" ? "video" : "photo";
}

/** Approved posts that are actually postable (media + a known platform). */
export async function listPublishablePosts(): Promise<Post[]> {
  const posts = await listPosts().catch(() => []);
  return posts.filter(
    (p) =>
      p.status === "approved" &&
      Boolean(p.renderUrl) &&
      normalizePlatform(p.platform) !== null
  );
}

/**
 * ALL approved posts, for display — including ones still rendering or waiting
 * on footage (no renderUrl yet). Shipped content shows up here immediately so
 * it's never invisible between /review and having postable media. The actual
 * publish actions still use listPublishablePosts (media required).
 */
export async function listApprovedPosts(): Promise<Post[]> {
  const posts = await listPosts().catch(() => []);
  return posts.filter(
    (p) => p.status === "approved" && normalizePlatform(p.platform) !== null
  );
}

/** Publish one approved post by id and, on success, mark it published. */
export async function publishPost(postId: string): Promise<PublishResult> {
  if (!hasDatabase()) {
    return {
      ok: false,
      platform: "instagram",
      error: "Studio database not configured — nothing to publish from.",
    };
  }
  const post = await getPostById(postId);
  if (!post) {
    return { ok: false, platform: "instagram", error: `Post not found: ${postId}` };
  }
  const platform = normalizePlatform(post.platform);
  if (!platform) {
    return {
      ok: false,
      platform: "instagram",
      error: `Unknown platform on post: ${post.platform}`,
    };
  }
  if (post.status !== "approved") {
    return {
      ok: false,
      platform,
      error: `Post is "${post.status}" — only approved posts can be published.`,
    };
  }
  if (!post.renderUrl) {
    return { ok: false, platform, error: "Post has no rendered media to post." };
  }

  const result = await publishRequest(
    {
      platform,
      caption: captionFor(post),
      mediaUrl: post.renderUrl,
      mediaType: mediaTypeFor(post),
    },
    postId
  );

  if (result.ok) {
    await updatePostStatus(postId, "published").catch(() => {});
    await postSignal({
      source: "marketing",
      headline: `Published to ${platform}: "${(post.copy ?? "").slice(0, 60)}"`,
    }).catch(() => {});
  }
  return result;
}

export interface PublishBatchResult {
  attempted: number;
  posted: number;
  failed: number;
  skipped: string | null;
  results: PublishResult[];
}

/**
 * Publish the approved queue (or up to `limit` of it). No-ops safely when the
 * DB or platforms aren't wired.
 */
export async function publishApprovedPosts(
  opts: { limit?: number } = {}
): Promise<PublishBatchResult> {
  const base: PublishBatchResult = {
    attempted: 0,
    posted: 0,
    failed: 0,
    skipped: null,
    results: [],
  };

  if (!hasDatabase()) {
    return { ...base, skipped: "Studio database not configured." };
  }
  if (!(await anyPlatformConnected())) {
    return {
      ...base,
      skipped: "No platform connected — add Meta / TikTok credentials.",
    };
  }

  const queue = (await listPublishablePosts()).slice(0, opts.limit ?? 25);
  for (const post of queue) {
    const result = await publishPost(post.id);
    base.attempted += 1;
    base.results.push(result);
    if (result.ok) base.posted += 1;
    else base.failed += 1;
  }
  return base;
}
