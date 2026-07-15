// ---------------------------------------------------------------------------
// publish/providers/meta.ts — Instagram + Facebook via the Meta Graph API
//
// Both platforms live on graph.facebook.com and share one access token.
//
//   Instagram (Business/Creator account, linked to a FB Page):
//     1. POST /{IG_USER_ID}/media          → create a media container
//     2. (video) poll the container until status_code = FINISHED
//     3. POST /{IG_USER_ID}/media_publish  → publish the container
//   Facebook (Page):
//     photo → POST /{FB_PAGE_ID}/photos    (url + caption)
//     video → POST /{FB_PAGE_ID}/videos    (file_url + description)
//     text  → POST /{FB_PAGE_ID}/feed      (message)
//
// Env: META_ACCESS_TOKEN (long-lived Page token with instagram_content_publish
// + pages_manage_posts), META_IG_USER_ID, META_FB_PAGE_ID, optional
// META_GRAPH_VERSION (default v21.0). Media must be a PUBLIC url.
// ---------------------------------------------------------------------------
import type {
  Platform,
  ProviderStatus,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";

const GRAPH = () =>
  `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;

function token(): string | undefined {
  return process.env.META_ACCESS_TOKEN;
}

async function graphPost(
  path: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, access_token: token() ?? "" });
  const res = await fetch(`${GRAPH()}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(err?.message ?? `Graph API ${res.status}`);
  }
  return json;
}

async function graphGet(
  path: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, access_token: token() ?? "" });
  const res = await fetch(`${GRAPH()}/${path}?${qs}`);
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

// ---- Instagram --------------------------------------------------------------

async function publishInstagram(req: PublishRequest): Promise<PublishResult> {
  const igUser = process.env.META_IG_USER_ID;
  if (!req.mediaUrl) {
    return {
      ok: false,
      platform: "instagram",
      error: "Instagram requires media — no mediaUrl on this piece.",
    };
  }
  const isVideo = req.mediaType === "video";
  const container = await graphPost(`${igUser}/media`, {
    caption: req.caption,
    ...(isVideo
      ? { media_type: "REELS", video_url: req.mediaUrl }
      : { image_url: req.mediaUrl }),
  });
  const creationId = String(container.id ?? "");
  if (!creationId) throw new Error("No media container id returned.");

  // Video containers must finish processing before they can be published.
  if (isVideo) {
    for (let i = 0; i < 20; i++) {
      const s = await graphGet(creationId, { fields: "status_code" });
      const code = String(s.status_code ?? "");
      if (code === "FINISHED") break;
      if (code === "ERROR") throw new Error("Instagram media processing failed.");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const published = await graphPost(`${igUser}/media_publish`, {
    creation_id: creationId,
  });
  const id = String(published.id ?? "");
  return {
    ok: true,
    platform: "instagram",
    externalId: id,
    permalink: id ? `https://www.instagram.com/p/${id}` : undefined,
  };
}

// ---- Facebook ---------------------------------------------------------------

async function publishFacebook(req: PublishRequest): Promise<PublishResult> {
  const page = process.env.META_FB_PAGE_ID;
  let result: Record<string, unknown>;
  if (req.mediaUrl && req.mediaType === "video") {
    result = await graphPost(`${page}/videos`, {
      file_url: req.mediaUrl,
      description: req.caption,
    });
  } else if (req.mediaUrl) {
    result = await graphPost(`${page}/photos`, {
      url: req.mediaUrl,
      caption: req.caption,
    });
  } else {
    result = await graphPost(`${page}/feed`, { message: req.caption });
  }
  const id = String(result.post_id ?? result.id ?? "");
  return {
    ok: true,
    platform: "facebook",
    externalId: id,
    permalink: id ? `https://www.facebook.com/${id}` : undefined,
  };
}

// ---- Provider factory -------------------------------------------------------

function metaProvider(platform: Platform): PublishProvider {
  return {
    platform,
    async status(): Promise<ProviderStatus> {
      const missing: string[] = [];
      if (!token()) missing.push("META_ACCESS_TOKEN");
      if (platform === "instagram" && !process.env.META_IG_USER_ID)
        missing.push("META_IG_USER_ID");
      if (platform === "facebook" && !process.env.META_FB_PAGE_ID)
        missing.push("META_FB_PAGE_ID");
      return {
        platform,
        connected: missing.length === 0,
        detail:
          missing.length === 0
            ? "connected (Meta Graph API)"
            : `set ${missing.join(" + ")}`,
      };
    },
    async publish(req: PublishRequest): Promise<PublishResult> {
      const st = await this.status();
      if (!st.connected) {
        return { ok: false, platform, error: st.detail };
      }
      try {
        return platform === "instagram"
          ? await publishInstagram(req)
          : await publishFacebook(req);
      } catch (err) {
        return {
          ok: false,
          platform,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export const instagramProvider = metaProvider("instagram");
export const facebookProvider = metaProvider("facebook");
