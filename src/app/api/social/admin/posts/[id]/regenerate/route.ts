import { NextResponse } from "next/server";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { getPostById } from "@/lib/social/queries";
import { regeneratePost } from "@/lib/social/planner/regenerate";

/**
 * Regenerate one post's copy with the brain (Phase 5). Needs DATABASE_URL +
 * ANTHROPIC_API_KEY. One Claude call, so it's quick — but give it headroom.
 *
 * Body (optional): { token? }
 */
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { token?: string } = {};
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    /* empty body ok */
  }

  const auth = checkAdminToken(tokenFromRequest(req, body));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Preview mode — regenerate needs a database + Claude key. Add DATABASE_URL and ANTHROPIC_API_KEY in Vercel.",
      },
      { status: 400 },
    );
  }

  const post = await getPostById(id);
  if (!post) {
    return NextResponse.json({ ok: false, error: "Post not found." }, { status: 404 });
  }

  try {
    const updated = await regeneratePost(post);
    return NextResponse.json({ ok: true, post: updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
