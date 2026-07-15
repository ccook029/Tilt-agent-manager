// ---------------------------------------------------------------------------
// publish/types.ts — the publishing contract for Instagram, TikTok, Facebook
//
// A provider knows how to (a) report whether it's connected and (b) post one
// piece. Everything is env-gated: with no credentials a provider reports
// connected:false and publish() refuses, so the whole layer is a safe no-op
// until Chris adds the platform tokens.
// ---------------------------------------------------------------------------

export type Platform = "instagram" | "tiktok" | "facebook";

export const PLATFORMS: Platform[] = ["instagram", "tiktok", "facebook"];

export interface PublishRequest {
  platform: Platform;
  /** Final caption/copy (already includes hashtags + CTA if wanted). */
  caption: string;
  /** Public URL of the media to post (Vercel Blob render URL, etc.). */
  mediaUrl?: string;
  mediaType?: "photo" | "video";
}

export interface PublishResult {
  ok: boolean;
  platform: Platform;
  /** The platform's id for the created post/media, on success. */
  externalId?: string;
  /** Where to view it, when the platform returns one. */
  permalink?: string;
  error?: string;
}

export interface ProviderStatus {
  platform: Platform;
  connected: boolean;
  /** Human-readable: "connected" or which env vars are missing. */
  detail: string;
}

export interface PublishProvider {
  platform: Platform;
  /** Async because some providers check stored OAuth tokens (KV). */
  status(): Promise<ProviderStatus>;
  publish(req: PublishRequest): Promise<PublishResult>;
}

/** Normalize a stored platform string ("IG", "Instagram") to a Platform. */
export function normalizePlatform(raw: string): Platform | null {
  const s = raw.trim().toLowerCase();
  if (s === "instagram" || s === "ig") return "instagram";
  if (s === "tiktok" || s === "tt") return "tiktok";
  if (s === "facebook" || s === "fb") return "facebook";
  return null;
}
