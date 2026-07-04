import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { announcements } from "@/lib/social/db/schema";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { mirrorToBlob } from "@/lib/social/blob";
import {
  writeAnnouncementCopy,
  renderAnnouncement,
  type AnnouncementKind,
} from "@/lib/social/announce/generate";
import { normalizeAccent } from "@/lib/social/announce/compose";

/**
 * Announcements (partnerships + ambassador welcomes).
 *
 * GET  -> list, newest first.
 * POST -> create + fully generate one:
 *   { kind: "partner"|"ambassador", name, subtitle?, sourceBase64, sourceMime, token? }
 *   sourceBase64 is the partner logo (PNG with transparency works best) or the
 *   ambassador's real photo. Uploads it to Blob, has the brain write the
 *   uniform caption, renders + composites the graphic, returns the row.
 */
export const maxDuration = 300;

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ ok: true, announcements: [] });
  const rows = await db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.createdAt));
  return NextResponse.json({ ok: true, announcements: rows });
}

type PostBody = {
  kind?: AnnouncementKind;
  name?: string;
  subtitle?: string;
  /** Partner website — typeset on the graphic + offered to the caption. */
  website?: string;
  /** Partner accent color (hex) — logo-card border + website line. */
  accentColor?: string;
  sourceBase64?: string;
  sourceMime?: string;
  token?: string;
};

export async function POST(req: Request) {
  let body: PostBody = {};
  try {
    body = (await req.json()) as PostBody;
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
          "Preview mode — announcements need a database, Claude, Gemini, and Blob configured in Vercel.",
      },
      { status: 400 },
    );
  }

  if (body.kind !== "partner" && body.kind !== "ambassador") {
    return NextResponse.json(
      { ok: false, error: `kind must be "partner" or "ambassador".` },
      { status: 400 },
    );
  }
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "name is required." }, { status: 400 });
  }
  if (!body.sourceBase64) {
    return NextResponse.json(
      {
        ok: false,
        error:
          body.kind === "partner"
            ? "Upload the partner's logo (PNG)."
            : "Upload the ambassador's photo — real assets only.",
      },
      { status: 400 },
    );
  }

  const accentColor = body.accentColor?.trim() ? normalizeAccent(body.accentColor) : null;
  if (body.accentColor?.trim() && !accentColor) {
    return NextResponse.json(
      { ok: false, error: "Accent colour must be a hex code like #00A7E1." },
      { status: 400 },
    );
  }

  try {
    // 1) The uploaded logo/photo goes to Blob first (render fetches it back).
    const sourceUrl = await mirrorToBlob({
      key: `announcements/sources/${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      buffer: Buffer.from(body.sourceBase64, "base64"),
      contentType: body.sourceMime || "image/png",
    });

    // 2) The brain writes the uniform caption.
    const copy = await writeAnnouncementCopy(body.kind, name, body.subtitle, body.website);

    const rows = await db
      .insert(announcements)
      .values({
        kind: body.kind,
        name,
        subtitle: body.subtitle?.trim() || null,
        website: body.website?.trim() || null,
        accentColor,
        sourceUrl,
        copy: copy.copy,
        hashtags: copy.hashtags,
        cta: copy.cta,
        graphicLine: copy.graphicLine,
      })
      .returning();
    const row = rows[0];

    // 3) Build + composite the graphic (partner graphics are fully code-built;
    //    ambassador designs come from the model, wordmark stamped by code).
    await renderAnnouncement(row);
    const fresh =
      (await db.select().from(announcements).where(eq(announcements.id, row.id)).limit(1))[0] ??
      row;

    return NextResponse.json({ ok: true, announcement: fresh });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
