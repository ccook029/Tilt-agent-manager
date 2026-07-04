import { put, head, BlobNotFoundError } from "@vercel/blob";

/**
 * Vercel Blob mirror helpers (Phase 1).
 *
 * The WorkDrive library is the source of truth; we mirror each file into Blob so
 * downstream phases (vision tagging, Nano Banana edits, Shotstack assembly, the
 * portal, email) have a stable, fast, public-CDN URL to work from.
 *
 * Auth: we never pass a token, so the SDK resolves it itself — a classic
 * BLOB_READ_WRITE_TOKEN if present, otherwise the Vercel OIDC connection
 * (VERCEL_OIDC_TOKEN + BLOB_STORE_ID, the dashboard default). Both work on Vercel
 * with no code change; locally you'd need BLOB_READ_WRITE_TOKEN.
 */

/** Deterministic blob key so re-runs overwrite rather than duplicate. */
export function blobKeyFor(workdriveId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `catalog/${workdriveId}/${safe}`;
}

export async function blobExists(key: string): Promise<string | null> {
  try {
    const meta = await head(key);
    return meta.url;
  } catch (err) {
    // Only "not found" means "not mirrored yet". Anything else (expired/missing
    // BLOB_READ_WRITE_TOKEN, store not found, network) must surface — otherwise
    // a bad token silently looks like "nothing mirrored" and we re-upload blindly.
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
  const { url } = await put(params.key, params.buffer, {
    access: "public",
    contentType: params.contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return url;
}
