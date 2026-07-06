import { put, head, get, BlobNotFoundError } from "@vercel/blob";

/**
 * Vercel Blob mirror helpers.
 *
 * The store is a **private** Blob store, so blobs are never exposed on a public
 * CDN URL. Instead:
 *   - uploads use `access: "private"`, and
 *   - `mirrorToBlob` returns an in-app proxy path (`/api/social/media/<key>`)
 *     that streams the bytes to signed-in staff (the OS-login middleware gates
 *     every /api/social/* route). That proxy path is what we store in the DB and
 *     drop into <img src>.
 *
 * For server-side re-reads (regenerating a flyer from its source upload, feeding
 * a catalog photo to the image model) use `readBlobBytes`, which pulls the bytes
 * back through the SDK with the store token rather than an HTTP fetch of a gated
 * URL.
 *
 * Auth: we never pass a token, so the SDK resolves it itself — a classic
 * BLOB_READ_WRITE_TOKEN if present, otherwise the Vercel OIDC connection
 * (VERCEL_OIDC_TOKEN + BLOB_STORE_ID, the dashboard default).
 */

// The app path that streams private blobs (see
// src/app/api/social/media/[...path]/route.ts). Relative, so it resolves to the
// current origin and rides the staff session cookie.
const MEDIA_PREFIX = "/api/social/media/";

/** In-app URL that streams a private blob to signed-in staff. */
export function blobProxyUrl(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${MEDIA_PREFIX}${encoded}`;
}

/** Recover the blob key from a proxy URL/path; null if it isn't one of ours. */
export function keyFromProxyUrl(ref: string): string | null {
  let path = ref;
  try {
    // Tolerate absolute forms (https://host/api/social/media/…) too.
    path = new URL(ref, "http://_").pathname;
  } catch {
    /* ref was already a path */
  }
  if (!path.startsWith(MEDIA_PREFIX)) return null;
  return path
    .slice(MEDIA_PREFIX.length)
    .split("/")
    .map(decodeURIComponent)
    .join("/");
}

/** Deterministic blob key so re-runs overwrite rather than duplicate. */
export function blobKeyFor(workdriveId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `catalog/${workdriveId}/${safe}`;
}

export async function blobExists(key: string): Promise<string | null> {
  try {
    await head(key);
    // Exists — hand back the proxy path (never the raw private URL).
    return blobProxyUrl(key);
  } catch (err) {
    // Only "not found" means "not mirrored yet". Anything else (expired/missing
    // token, store not found, network) must surface — otherwise a bad token
    // silently looks like "nothing mirrored" and we re-upload blindly.
    // Must be an instanceof check: the SDK never sets err.name (it stays "Error").
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

export async function mirrorToBlob(params: {
  key: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string> {
  await put(params.key, params.buffer, {
    access: "private",
    contentType: params.contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blobProxyUrl(params.key);
}

/**
 * Read a blob's bytes server-side. Accepts one of our proxy URLs/keys (pulled
 * back through the private-store token) or, as a fallback, any absolute external
 * URL (plain fetch).
 */
export async function readBlobBytes(
  ref: string,
): Promise<{ buf: Buffer; mime: string }> {
  const key = keyFromProxyUrl(ref);
  if (key) {
    const r = await get(key, { access: "private" });
    if (!r || !r.stream) throw new Error(`Blob not found: ${key}`);
    const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
    const mime =
      r.headers.get("content-type") ?? r.blob.contentType ?? "image/png";
    return { buf, mime };
  }
  // Not one of ours — treat as an external absolute URL.
  const res = await fetch(ref);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    mime: res.headers.get("content-type") ?? "image/png",
  };
}
