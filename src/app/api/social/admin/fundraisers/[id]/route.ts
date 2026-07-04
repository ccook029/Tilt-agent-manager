import { NextResponse } from "next/server";
import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { fundraisers } from "@/lib/social/db/schema";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { writeFundraiserCopy, renderFundraiser } from "@/lib/social/fundraiser/generate";

/**
 * Single-fundraiser actions.
 *
 * PATCH { action: "regenerate" }       -> fresh caption + fresh flyer
 * PATCH { action: "rerender" }         -> keep the caption, redo the flyer
 * DELETE                               -> remove the fundraiser
 */
export const maxDuration = 300;

type PatchBody = {
  action?: "regenerate" | "rerender";
  revisionNote?: string;
  token?: string;
};

async function getRow(id: string) {
  const rows = await db.select().from(fundraisers).where(eq(fundraisers.id, id)).limit(1);
  return rows[0] ?? null;
}

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

  let row = await getRow(id);
  if (!row) {
    return NextResponse.json({ ok: false, error: "Fundraiser not found." }, { status: 404 });
  }

  if (body.action !== "regenerate" && body.action !== "rerender") {
    return NextResponse.json(
      { ok: false, error: `action must be "regenerate" or "rerender".` },
      { status: 400 },
    );
  }

  // Persist any revision feedback so the render (and future re-renders) honor it.
  // An empty string clears a previous note.
  if (body.revisionNote !== undefined) {
    const note = body.revisionNote.trim() || null;
    const rows = await db
      .update(fundraisers)
      .set({ revisionNote: note, updatedAt: raw`now()` })
      .where(eq(fundraisers.id, id))
      .returning();
    row = rows[0] ?? row;
  }

  try {
    let updated = row;
    if (body.action === "regenerate") {
      const copy = await writeFundraiserCopy(
        row.orgName,
        row.deadline,
        row.paymentEmail,
        row.note,
      );
      const rows = await db
        .update(fundraisers)
        .set({
          copy: copy.copy,
          hashtags: copy.hashtags,
          cta: copy.cta,
          graphicLine: copy.graphicLine,
          updatedAt: raw`now()`,
        })
        .where(eq(fundraisers.id, id))
        .returning();
      updated = rows[0] ?? row;
    }

    const imageUrl = await renderFundraiser(updated);
    return NextResponse.json({ ok: true, fundraiser: { ...updated, imageUrl } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = checkAdminToken(tokenFromRequest(req));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }
  if (isDemoMode()) {
    return NextResponse.json({ ok: true, demo: true });
  }
  await db.delete(fundraisers).where(eq(fundraisers.id, id));
  return NextResponse.json({ ok: true });
}
