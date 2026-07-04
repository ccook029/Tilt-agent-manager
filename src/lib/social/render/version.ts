/**
 * Brand-stamp versioning for renders.
 *
 * Render blob keys embed their creation time (renders/<postId>-<ms>.png).
 * Bump RENDER_EPOCH whenever the branding overlay changes (logo artwork,
 * anchor layout): any render produced before it is treated as stale, counted
 * as pending, and re-rendered automatically on the next Posts page visit.
 *
 * Client-safe: no node imports.
 */
export const RENDER_EPOCH = Date.parse("2026-06-12T04:26:00Z"); // anchor-band branding

export function isStaleRender(renderUrl: string | null | undefined): boolean {
  if (!renderUrl) return false; // never rendered — that's "missing", not "stale"
  const m = renderUrl.match(/-(\d{13})\.(?:png|mp4)(?:\?|$)/);
  if (!m) return true; // pre-timestamp key — predates the current branding
  return Number(m[1]) < RENDER_EPOCH;
}

/** A post the pipelines can (re)render: no visual yet, or an outdated one. */
export function needsRender(p: {
  renderKind: string | null;
  assetId: string | null;
  renderUrl: string | null;
  assetType?: "photo" | "video" | null;
}): boolean {
  if (p.assetId == null) return false;
  if (p.renderUrl && !isStaleRender(p.renderUrl)) return false;
  // Statics need a photo (nano can't treat video); reels need a video clip.
  if (p.renderKind === "nano") return p.assetType !== "video";
  if (p.renderKind === "shotstack") return p.assetType !== "photo";
  return false;
}
