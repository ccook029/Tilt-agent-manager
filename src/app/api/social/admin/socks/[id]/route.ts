import { NextResponse } from "next/server";
import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { sockDesigns } from "@/lib/social/db/schema";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { writeSockPitch, renderSockDesign, renderSockFlyer } from "@/lib/social/sock/generate";

/**
 * Single sock-design actions.
 *
 * PATCH { action: "redesign" }    -> fresh sock mockup + rebuilt flyer
 * PATCH { action: "regenerate" }  -> fresh pitch copy + rebuilt flyer (keep mockup)
 * PATCH { action: "rerender" }    -> rebuild the flyer only (keep mockup + copy)
 * DELETE                          -> remove the sock design
 */
export const maxDuration = 300;

type PatchBody = {
  action?: "redesign" | "regenerate" | "rerender";
  revisionNote?: string;
  token?: string;
};

async function getRow(id: string) {
  const rows = await db.select().from(sockDesigns).where(eq(sockDesigns.id, id)).limit(1);
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
    return NextResponse.json({ ok: false, error: "Sock design not found." }, { status: 404 });
  }

  if (body.action !== "redesign" && body.action !== "regenerate" && body.action !== "rerender") {
    return NextResponse.json(
      { ok: false, error: `action must be "redesign", "regenerate", or "rerender".` },
      { status: 400 },
    );
  }

  // Persist any revision feedback so the render (and future re-renders) honor it.
  // An empty string clears a previous note.
  if (body.revisionNote !== undefined) {
    const note = body.revisionNote.trim() || null;
    const rows = await db
      .update(sockDesigns)
      .set({ revisionNote: note, updatedAt: raw`now()` })
      .where(eq(sockDesigns.id, id))
      .returning();
    row = rows[0] ?? row;
  }

  try {
    let updated = row;

    if (body.action === "regenerate") {
      const pitch = await writeSockPitch(row.orgName, row.colors, row.note);
      const rows = await db
        .update(sockDesigns)
        .set({
          copy: pitch.copy,
          hashtags: pitch.hashtags,
          cta: pitch.cta,
          graphicLine: pitch.graphicLine,
          updatedAt: raw`now()`,
        })
        .where(eq(sockDesigns.id, id))
        .returning();
      updated = rows[0] ?? row;
    }

    let designUrl = updated.designUrl;
    if (body.action === "redesign") {
      designUrl = await renderSockDesign(updated);
      updated = { ...updated, designUrl };
    }

    const flyerUrl = await renderSockFlyer(updated);
    return NextResponse.json({ ok: true, sock: { ...updated, designUrl, flyerUrl } });
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
  await db.delete(sockDesigns).where(eq(sockDesigns.id, id));
  return NextResponse.json({ ok: true });
}
