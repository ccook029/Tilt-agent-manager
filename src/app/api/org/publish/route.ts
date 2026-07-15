// ---------------------------------------------------------------------------
// /api/org/publish — the publisher surface for Instagram / TikTok / Facebook
//
// GET  → connection status per platform + the publishable (approved) queue +
//        recent publish log.
// POST { action: "publish-post", postId }   → post one approved Studio post
//      { action: "publish-all", limit? }     → post the approved queue
//      { action: "publish-adhoc", platform, caption, mediaUrl?, mediaType? }
//                                             → post an arbitrary piece now
// Auth: Tilt OS middleware. Nothing here posts until platform tokens are set.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  getConnectionStatus,
  getPublishLog,
  publishRequest,
} from "@/lib/publish";
import { normalizePlatform } from "@/lib/publish/types";
import {
  listPublishablePosts,
  publishApprovedPosts,
  publishPost,
} from "@/lib/pipelines/publish";
import { hasDatabase } from "@/lib/social/env";

export const maxDuration = 300;

export async function GET() {
  const [queue, log, connections] = await Promise.all([
    hasDatabase() ? listPublishablePosts().catch(() => []) : Promise.resolve([]),
    getPublishLog(30).catch(() => []),
    getConnectionStatus(),
  ]);
  return NextResponse.json({
    connections,
    databaseConfigured: hasDatabase(),
    queue: queue.map((p) => ({
      id: p.id,
      platform: p.platform,
      copy: (p.copy ?? "").slice(0, 200),
      renderUrl: p.renderUrl,
      renderKind: p.renderKind,
      scheduledDate: p.scheduledDate,
    })),
    log,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      postId?: string;
      limit?: number;
      platform?: string;
      caption?: string;
      mediaUrl?: string;
      mediaType?: "photo" | "video";
    };

    switch (body.action) {
      case "publish-post": {
        if (!body.postId) {
          return NextResponse.json({ error: "postId required" }, { status: 400 });
        }
        const result = await publishPost(body.postId);
        return NextResponse.json({ ok: result.ok, result });
      }
      case "publish-all": {
        const result = await publishApprovedPosts({ limit: body.limit });
        return NextResponse.json({ ok: true, ...result });
      }
      case "publish-adhoc": {
        const platform = normalizePlatform(body.platform ?? "");
        if (!platform || !body.caption?.trim()) {
          return NextResponse.json(
            { error: "platform and caption are required." },
            { status: 400 }
          );
        }
        const result = await publishRequest({
          platform,
          caption: body.caption,
          mediaUrl: body.mediaUrl,
          mediaType: body.mediaType,
        });
        return NextResponse.json({ ok: result.ok, result });
      }
      default:
        return NextResponse.json(
          {
            error:
              'action must be "publish-post", "publish-all", or "publish-adhoc".',
          },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("[api] org/publish POST failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
