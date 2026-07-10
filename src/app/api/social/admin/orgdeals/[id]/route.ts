import { NextResponse } from "next/server";
import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { orgStickDeals } from "@/lib/social/db/schema";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import {
  writeOrgDealContent,
  renderOrgDealGraphics,
  renderOrgDealPitch,
} from "@/lib/social/orgdeal/generate";

/**
 * Single org-program actions.
 *
 * PATCH { action: "regenerate" }  -> fresh copy (pitch + email + social) AND fresh renders
 * PATCH { action: "rerender" }    -> keep the wording, redo the graphics + pitch PDF
 * DELETE                          -> remove the program
 */
export const maxDuration = 300;

type PatchBody = {
  action?: "regenerate" | "rerender";
  revisionNote?: string;
  token?: string;
};

async function getRow(id: string) {
  const rows = await db.select().from(orgStickDeals).where(eq(orgStickDeals.id, id)).limit(1);
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
    return NextResponse.json({ ok: false, error: "Org program not found." }, { status: 404 });
  }

  if (body.action !== "regenerate" && body.action !== "rerender") {
    return NextResponse.json(
      { ok: false, error: `action must be "regenerate" or "rerender".` },
      { status: 400 },
    );
  }

  // Persist any revision feedback; an empty string clears a previous note.
  if (body.revisionNote !== undefined) {
    const note = body.revisionNote.trim() || null;
    const rows = await db
      .update(orgStickDeals)
      .set({ revisionNote: note, updatedAt: raw`now()` })
      .where(eq(orgStickDeals.id, id))
      .returning();
    row = rows[0] ?? row;
  }

  try {
    if (body.action === "regenerate") {
      const content = await writeOrgDealContent({
        orgName: row.orgName,
        discountPct: row.discountPct,
        kickbackPct: row.kickbackPct,
        deadline: row.deadline,
        deliveryDate: row.deliveryDate,
        orderUrl: row.orderUrl,
        contactName: row.contactName,
        // Revision feedback rides along as extra guidance for the rewrite.
        note: [row.note, row.revisionNote].filter(Boolean).join(" — ") || null,
      });
      const rows = await db
        .update(orgStickDeals)
        .set({
          copy: content.social.copy,
          hashtags: content.social.hashtags,
          cta: content.social.cta,
          graphicLine: content.social.graphicLine,
          emailSubject: content.email.subject,
          emailBody: content.email.body,
          pitch: content.pitch,
          updatedAt: raw`now()`,
        })
        .where(eq(orgStickDeals.id, id))
        .returning();
      row = rows[0] ?? row;
    }

    await renderOrgDealGraphics(row);
    await renderOrgDealPitch(row);
    const fresh = await getRow(id);
    return NextResponse.json({ ok: true, orgDeal: fresh ?? row });
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
  await db.delete(orgStickDeals).where(eq(orgStickDeals.id, id));
  return NextResponse.json({ ok: true });
}
