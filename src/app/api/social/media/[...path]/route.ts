import { get } from "@vercel/blob";

/**
 * Streams a private Blob to signed-in staff.
 *
 * The store is private, so blobs have no public URL. The OS-login middleware
 * already gates every /api/social/* path, so any request that reaches here is
 * authenticated; we then pull the blob server-side with the store token and
 * stream it straight back. This is what every <img src="/api/social/media/…">
 * (flyers, sock/blanket renders, catalog photos) resolves to.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const key = path.map(decodeURIComponent).join("/");

  try {
    const r = await get(key, { access: "private" });
    if (!r || !r.stream) {
      return new Response("Not found", { status: 404 });
    }
    const contentType =
      r.headers.get("content-type") ?? r.blob.contentType ?? "application/octet-stream";
    return new Response(r.stream, {
      headers: {
        "content-type": contentType,
        // Private to the browser cache; short-lived so re-renders show through.
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
