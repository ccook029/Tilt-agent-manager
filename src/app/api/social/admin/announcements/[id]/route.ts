import { NextResponse } from "next/server";
import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { announcements } from "@/lib/social/db/schema";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { writeAnnouncementCopy, renderAnnouncement } from "@/lib/social/announce/generate";
import { normalizeAccent } from "@/lib/social/announce/compose";

/**
 * Single-announcement actions.
 *
 * PATCH { action: "regenerate" }       -> fresh caption + fresh graphic
 * PATCH { action: "rerender" }         -> keep the caption, redo the graphic
 * PATCH { action: "layout", ... }      -> save logo placement, re-composite
 *                                         (partner graphics are code-built, so
 *                                         this is instant and costs nothing)
 * DELETE                               -> remove the announcement
 */
export const maxDuration = 300;

const LOGO_POSITIONS = ["left", "center", "right"] as const;
const LOGO_SCALES = ["sm", "md", "lg"] as const;

type PatchBody = {
  action?: "regenerate" | "rerender" | "layout";
  logoPosition?: (typeof LOGO_POSITIONS)[number];
  logoScale?: (typeof LOGO_SCALES)[number];
  lockup?: boolean;
  /** "" clears the website; omitted leaves it untouched. */
  website?: string;
  /** "" clears the accent colour; omitted leaves it untouched. */
  accentColor?: string;
  token?: string;
};

async function getRow(id: string) {
  const rows = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
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

  const row = await getRow(id);
  if (!row) {
    return NextResponse.json({ ok: false, error: "Announcement not found." }, { status: 404 });
  }

  try {
    let updated = row;
    if (body.action === "layout") {
      if (row.kind !== "partner") {
        return NextResponse.json(
          { ok: false, error: "Layout controls only apply to partnership graphics." },
          { status: 400 },
        );
      }
      const fields: Partial<typeof row> = {};
      if (body.logoPosition !== undefined) {
        if (!LOGO_POSITIONS.includes(body.logoPosition)) {
          return NextResponse.json(
            { ok: false, error: `logoPosition must be one of: ${LOGO_POSITIONS.join(", ")}.` },
            { status: 400 },
          );
        }
        fields.logoPosition = body.logoPosition;
      }
      if (body.logoScale !== undefined) {
        if (!LOGO_SCALES.includes(body.logoScale)) {
          return NextResponse.json(
            { ok: false, error: `logoScale must be one of: ${LOGO_SCALES.join(", ")}.` },
            { status: 400 },
          );
        }
        fields.logoScale = body.logoScale;
      }
      if (body.lockup !== undefined) fields.lockup = Boolean(body.lockup);
      if (body.website !== undefined) fields.website = body.website.trim() || null;
      if (body.accentColor !== undefined) {
        const accent = body.accentColor.trim() ? normalizeAccent(body.accentColor) : null;
        if (body.accentColor.trim() && !accent) {
          return NextResponse.json(
            { ok: false, error: "Accent colour must be a hex code like #00A7E1." },
            { status: 400 },
          );
        }
        fields.accentColor = accent;
      }

      const rows = await db
        .update(announcements)
        .set({ ...fields, updatedAt: raw`now()` })
        .where(eq(announcements.id, id))
        .returning();
      updated = rows[0] ?? row;
    } else if (body.action === "regenerate") {
      const copy = await writeAnnouncementCopy(
        row.kind as "partner" | "ambassador",
        row.name,
        row.subtitle,
        row.website,
      );
      const rows = await db
        .update(announcements)
        .set({
          copy: copy.copy,
          hashtags: copy.hashtags,
          cta: copy.cta,
          graphicLine: copy.graphicLine,
          updatedAt: raw`now()`,
        })
        .where(eq(announcements.id, id))
        .returning();
      updated = rows[0] ?? row;
    } else if (body.action !== "rerender") {
      return NextResponse.json(
        { ok: false, error: `action must be "regenerate", "rerender", or "layout".` },
        { status: 400 },
      );
    }

    await renderAnnouncement(updated);
    const fresh = (await getRow(id)) ?? updated;
    return NextResponse.json({ ok: true, announcement: fresh });
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
  await db.delete(announcements).where(eq(announcements.id, id));
  return NextResponse.json({ ok: true });
}
