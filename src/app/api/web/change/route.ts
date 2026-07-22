// POST /api/web/change — open a PR against the storefront for Nova's change.
// Body: { request, path, title }. Auth: Tilt OS middleware (founder console).
import { NextRequest, NextResponse } from "next/server";
import { executeWebChange } from "@/lib/web/change-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    request?: string;
    path?: string;
    title?: string;
  };
  if (!body.request?.trim() || !body.path?.trim() || !body.title?.trim()) {
    return NextResponse.json(
      { ok: false, error: "request, path, and title are required" },
      { status: 400 }
    );
  }
  const result = await executeWebChange({
    request: body.request.trim(),
    path: body.path.trim(),
    title: body.title.trim(),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
