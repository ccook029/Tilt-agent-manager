import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { posts, assets, type Post } from "@/lib/social/db/schema";
import { mirrorToBlob, readBlobBytes } from "@/lib/social/blob";
import { nanoEdit } from "./nano";
import { overlayBranding, type RenderFormat } from "./overlay";
import { isStaleRender } from "./version";
import { submitReel, fetchReelResult, shotstackConfigured } from "./shotstack";
import { postSignal } from "@/lib/signals";

/**
 * Phase 3 static render pipeline.
 *
 * For a post with render_kind = "nano": take the matched REAL photo, send it to
 * Nano Banana Pro for the treatment + display text (per the brain's edit brief),
 * then composite the TILT logo in code, upload the result to Blob, and store the
 * URL on the post. Real assets only; logo never AI-rendered.
 */

export type RenderResult = {
  postId: string;
  renderUrl?: string;
  skipped?: string;
  error?: string;
};

function toFormat(f: string | null): RenderFormat {
  return f === "reel" || f === "carousel" ? f : "static";
}

// Catalog assets are private blobs; pull the bytes back through the store token
// rather than fetching a login-gated URL.
async function fetchBytes(ref: string): Promise<{ buf: Buffer; mime: string }> {
  return readBlobBytes(ref);
}

/** Renders one static post. Returns the render URL (also persisted). */
export async function renderStaticPost(post: Post): Promise<RenderResult> {
  if (post.renderKind !== "nano") {
    return { postId: post.id, skipped: `render_kind=${post.renderKind}` };
  }
  if (!post.assetId) {
    return { postId: post.id, skipped: "no matched asset" };
  }

  const a = (await db.select().from(assets).where(eq(assets.id, post.assetId)).limit(1))[0];
  if (!a?.blobUrl) return { postId: post.id, skipped: "asset has no blob url" };
  if (a.type !== "photo") return { postId: post.id, skipped: "asset is not a photo" };

  try {
    const { buf, mime } = await fetchBytes(a.blobUrl);

    // 1) Nano Banana Pro treats the REAL photo (treatment + display text).
    const edited = await nanoEdit({
      sourceImage: buf,
      sourceMimeType: mime,
      brief: { brief: post.editBrief ?? "Clean Tilt brand treatment.", displayText: undefined },
    });

    // 2) Code composites the TILT logo (never AI-rendered).
    const branded = await overlayBranding(edited.image, toFormat(post.format));

    // 3) Upload + persist. Timestamped key so a re-render (e.g. after a logo
    // or treatment change) never gets masked by a stale CDN-cached URL.
    const url = await mirrorToBlob({
      key: `renders/${post.id}-${Date.now()}.png`,
      buffer: branded,
      contentType: "image/png",
    });
    await db.update(posts).set({ renderUrl: url }).where(eq(posts.id, post.id));

    return { postId: post.id, renderUrl: url };
  } catch (err) {
    return { postId: post.id, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Renders all nano posts that are missing an image OR carry one made with
 * outdated branding (see RENDER_EPOCH in version.ts). Pass `force` to
 * re-render everything regardless.
 */
export async function renderPendingStatics(opts?: {
  limit?: number;
  force?: boolean;
  onProgress?: (m: string) => void;
}): Promise<RenderResult[]> {
  const log = opts?.onProgress ?? (() => {});
  const pending = await db
    .select()
    .from(posts)
    .where(and(eq(posts.renderKind, "nano"), isNotNull(posts.assetId)))
    .limit(opts?.limit ?? 50);

  const results: RenderResult[] = [];
  for (const p of pending) {
    if (p.renderUrl && !opts?.force && !isStaleRender(p.renderUrl)) {
      results.push({ postId: p.id, skipped: "already rendered" });
      continue;
    }
    log(`  ▦ rendering post ${p.id} (${p.platform}, ${p.pillar})…`);
    results.push(await renderStaticPost(p));
  }

  const rendered = results.filter((r) => r.renderUrl).length;
  const failed = results.filter((r) => r.error).length;
  if (rendered > 0) {
    // Fire-and-forget: a missing KV store must never fail a render run.
    await postSignal({
      source: "social-studio",
      headline: `${rendered} branded visual(s) rendered for upcoming posts`,
      detail: failed ? `${failed} render(s) failed` : undefined,
    }).catch(() => {});
  }

  return results;
}

/**
 * Renders pending reels via Shotstack. Platform variants of the same slot
 * (same asset + brief) share ONE render — credits are spent per piece, not per
 * platform. All jobs are submitted up front (Shotstack renders concurrently),
 * then collected and mirrored to Blob.
 */
export async function renderPendingReels(opts?: {
  limit?: number;
  force?: boolean;
  onProgress?: (m: string) => void;
}): Promise<RenderResult[]> {
  const log = opts?.onProgress ?? (() => {});
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.renderKind, "shotstack"), isNotNull(posts.assetId)))
    .limit(opts?.limit ?? 24);

  const pending = rows.filter(
    (p) => opts?.force || !p.renderUrl || isStaleRender(p.renderUrl),
  );
  if (pending.length === 0) return [];

  if (!shotstackConfigured()) {
    return pending.map((p) => ({
      postId: p.id,
      skipped: "video pipeline not configured (SHOTSTACK_API_KEY)",
    }));
  }

  const results: RenderResult[] = [];

  // Group platform variants that share an asset + brief into one render job.
  const groups = new Map<string, Post[]>();
  for (const p of pending) {
    const key = `${p.assetId}|${p.editBrief ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(p);
    groups.set(key, group);
  }

  // Submit every group's job up front.
  const jobs: { group: Post[]; jobId: string }[] = [];
  for (const group of groups.values()) {
    const lead = group[0];
    const a = (
      await db.select().from(assets).where(eq(assets.id, lead.assetId!)).limit(1)
    )[0];
    if (!a?.blobUrl || a.type !== "video") {
      for (const p of group) {
        results.push({ postId: p.id, skipped: "matched asset is not a video" });
      }
      continue;
    }
    try {
      log(`  ▶ submitting reel · ${lead.scheduledDate} · ${lead.pillar}…`);
      const jobId = await submitReel({
        videoUrl: a.blobUrl,
        caption: lead.cta ?? undefined,
      });
      jobs.push({ group, jobId });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      for (const p of group) results.push({ postId: p.id, error });
    }
  }

  // Collect finished renders; one URL persisted across the whole group.
  for (const job of jobs) {
    try {
      const bytes = await fetchReelResult(job.jobId);
      const url = await mirrorToBlob({
        key: `renders/${job.group[0].id}-${Date.now()}.mp4`,
        buffer: bytes,
        contentType: "video/mp4",
      });
      for (const p of job.group) {
        await db.update(posts).set({ renderUrl: url }).where(eq(posts.id, p.id));
        results.push({ postId: p.id, renderUrl: url });
      }
      log(`  ✔ reel done · ${job.group[0].scheduledDate} · ${job.group[0].pillar}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      for (const p of job.group) results.push({ postId: p.id, error });
    }
  }

  return results;
}
