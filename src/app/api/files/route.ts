// ---------------------------------------------------------------------------
// /api/files — the staff file cabinet, backed by Vercel Blob.
//
// GET    → list files under staff-files/
// POST   → upload (multipart form, field "file")
// DELETE → ?url=<blob url>
//
// Auth: the OS middleware gates this like every other route. Requires
// BLOB_READ_WRITE_TOKEN (add Blob storage to the Vercel project); returns a
// friendly 503 until it's configured.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { del, list, put } from "@vercel/blob";
import { blobProxyUrl, keyFromProxyUrl } from "@/lib/social/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PREFIX = "staff-files/";
const MAX_BYTES = 50 * 1024 * 1024; // 50MB per file

function notConfigured() {
  return NextResponse.json(
    {
      error:
        "File storage isn't set up yet — add a Blob store to this Vercel project (Storage → Create → Blob) so BLOB_READ_WRITE_TOKEN is available, then redeploy.",
    },
    { status: 503 }
  );
}

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return notConfigured();
  const { blobs } = await list({ prefix: PREFIX, limit: 500 });
  return NextResponse.json({
    ok: true,
    files: blobs
      .map((b) => ({
        name: b.pathname.slice(PREFIX.length),
        // Private store — serve through the gated proxy, not the raw blob URL.
        url: blobProxyUrl(b.pathname),
        size: b.size,
        uploadedAt: b.uploadedAt,
      }))
      .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)),
  });
}

export async function POST(request: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return notConfigured();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File is over the 50MB limit." },
      { status: 413 }
    );
  }
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
  const blob = await put(`${PREFIX}${safeName}`, file, {
    access: "private",
    addRandomSuffix: true,
  });
  return NextResponse.json({ ok: true, url: blobProxyUrl(blob.pathname) });
}

export async function DELETE(request: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return notConfigured();
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  // The client holds the proxy path; delete by the underlying blob key.
  await del(keyFromProxyUrl(url) ?? url);
  return NextResponse.json({ ok: true });
}
