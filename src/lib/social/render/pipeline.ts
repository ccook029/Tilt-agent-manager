import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { posts, assets, type Post } from "@/lib/social/db/schema";
import { mirrorToBlob } from "@/lib/social/blob";
// Signals go straight into the hub's KV inbox now that the studio runs
// natively inside HQ (no HTTP hop / TILT_HQ_URL indirection).
import { postSignal } from "@/lib/signals";
import { nanoEdit } from "./nano";
import { overlayBranding, type RenderFormat } from "./overlay";

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

async function fetchBytes(url: string): Promise<{ buf: Buffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch source failed: ${res.status}`);
  const mime = res.headers.get("content-type") ?? "image/jpeg";
  return { buf: Buffer.from(await res.arrayBuffer()), mime };
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

    // 3) Upload + persist.
    const url = await mirrorToBlob({
      key: `renders/${post.id}.png`,
      buffer: branded,
      contentType: "image/png",
    });
    await db.update(posts).set({ renderUrl: url }).where(eq(posts.id, post.id));

    return { postId: post.id, renderUrl: url };
  } catch (err) {
    return { postId: post.id, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Renders all nano posts that don't yet have a render_url. */
export async function renderPendingStatics(opts?: {
  limit?: number;
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
    if (p.renderUrl) {
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
