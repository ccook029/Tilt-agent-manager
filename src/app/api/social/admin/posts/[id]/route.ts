import { NextResponse } from "next/server";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { updatePostContent, updatePostStatus, convertPostToAutoCut } from "@/lib/social/queries";

/**
 * Review actions on a single post (Phase 5).
 *
 * PATCH body (one of):
 *   { action: "approve" }        -> status = approved
 *   { action: "needs_review" }   -> status = needs_review (un-approve)
 *   { action: "auto_cut" }       -> manual-edit video post -> Shotstack auto-cut
 *   { copy?, hashtags?, cta? }   -> edit the founder's copy (drops to needs_review)
 *
 * In preview mode there's no database, so mutations are a no-op success
 * ({ demo: true }) — the UI updates optimistically so the workflow is fully
 * clickable without a backend.
 */
type PatchBody = {
  action?: "approve" | "needs_review" | "auto_cut";
  copy?: string;
  hashtags?: string[];
  cta?: string;
  token?: string;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: PatchBody = {};
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    /* empty body ok */
  }

  const auth = checkAdminToken(tokenFromRequest(req, body));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ ok: true, demo: true });
  }

  try {
    let post = null;
    if (body.action === "approve") {
      post = await updatePostStatus(id, "approved");
    } else if (body.action === "needs_review") {
      post = await updatePostStatus(id, "needs_review");
    } else if (body.action === "auto_cut") {
      post = await convertPostToAutoCut(id);
    } else if (
      body.copy !== undefined ||
      body.hashtags !== undefined ||
      body.cta !== undefined
    ) {
      post = await updatePostContent(id, {
        copy: body.copy,
        hashtags: body.hashtags,
        cta: body.cta,
      });
    } else {
      return NextResponse.json(
        { ok: false, error: "Nothing to update — pass an action or copy/hashtags/cta." },
        { status: 400 },
      );
    }

    if (!post) {
      return NextResponse.json({ ok: false, error: "Post not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, post });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
