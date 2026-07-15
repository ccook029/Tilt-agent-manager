// ---------------------------------------------------------------------------
// publish/providers/tiktok.ts — TikTok Content Posting API (Direct Post)
//
// Direct Post flow (video), PULL_FROM_URL source:
//   POST https://open.tiktokapis.com/v2/post/publish/video/init/
//     { post_info: { title, privacy_level, ... },
//       source_info: { source: "PULL_FROM_URL", video_url } }
//   → { data: { publish_id } }, then status is polled at
//   POST /v2/post/publish/status/fetch/ with { publish_id }.
//
// Requirements: TIKTOK_ACCESS_TOKEN (user token with video.publish scope);
// the app must be approved for Direct Post and the pull-from-url domain must be
// verified in the TikTok developer portal. Optional TIKTOK_PRIVACY_LEVEL
// (default SELF_ONLY, the safe sandbox value until the app is live —
// PUBLIC_TO_EVERYONE once approved).
//
// TikTok only accepts VIDEO here; photo/text pieces are rejected with a clear
// error so they don't silently drop.
// ---------------------------------------------------------------------------
import type {
  ProviderStatus,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";

const BASE = "https://open.tiktokapis.com/v2";

function token(): string | undefined {
  return process.env.TIKTOK_ACCESS_TOKEN;
}

async function ttPost(
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = json.error as { code?: string; message?: string } | undefined;
  if (err && err.code && err.code !== "ok") {
    throw new Error(err.message ?? `TikTok API error ${err.code}`);
  }
  if (!res.ok) throw new Error(`TikTok API ${res.status}`);
  return json;
}

export const tiktokProvider: PublishProvider = {
  platform: "tiktok",
  status(): ProviderStatus {
    return {
      platform: "tiktok",
      connected: Boolean(token()),
      detail: token()
        ? `connected (Content Posting API, privacy ${
            process.env.TIKTOK_PRIVACY_LEVEL ?? "SELF_ONLY"
          })`
        : "set TIKTOK_ACCESS_TOKEN",
    };
  },
  async publish(req: PublishRequest): Promise<PublishResult> {
    if (!token()) {
      return { ok: false, platform: "tiktok", error: "set TIKTOK_ACCESS_TOKEN" };
    }
    if (!req.mediaUrl || req.mediaType !== "video") {
      return {
        ok: false,
        platform: "tiktok",
        error: "TikTok posts require a video mediaUrl.",
      };
    }
    try {
      const init = await ttPost("post/publish/video/init/", {
        post_info: {
          title: req.caption.slice(0, 2200),
          privacy_level: process.env.TIKTOK_PRIVACY_LEVEL ?? "SELF_ONLY",
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: req.mediaUrl,
        },
      });
      const data = (init.data ?? {}) as Record<string, unknown>;
      const publishId = String(data.publish_id ?? "");
      if (!publishId) throw new Error("No publish_id returned by TikTok.");
      // Direct Post is async; the video appears once TikTok finishes pulling +
      // processing. We return the publish_id as the external id rather than
      // blocking on the full status poll (which can take minutes).
      return { ok: true, platform: "tiktok", externalId: publishId };
    } catch (err) {
      return {
        ok: false,
        platform: "tiktok",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
