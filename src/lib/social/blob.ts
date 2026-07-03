import { put, head } from "@vercel/blob";

/**
 * Vercel Blob mirror helpers (Phase 1).
 *
 * The WorkDrive library is the source of truth; we mirror each file into Blob so
 * downstream phases (vision tagging, Nano Banana edits, Shotstack assembly, the
 * portal, email) have a stable, fast, public-CDN URL to work from.
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
  } catch {
    return null;
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
