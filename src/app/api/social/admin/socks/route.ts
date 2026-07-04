import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { sockDesigns } from "@/lib/social/db/schema";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { mirrorToBlob } from "@/lib/social/blob";
import { writeSockPitch, renderSockDesign, renderSockFlyer } from "@/lib/social/sock/generate";

/**
 * Custom sock designs (B2B concept + pitch flyer).
 *
 * GET  -> list, newest first.
 * POST -> create + fully generate one:
 *   { orgName, colors?, note?, logoBase64, logoMime, token? }
 *   logoBase64 is the org's logo/crest. Uploads it to Blob, has the brain write
 *   the pitch copy, designs the sock mockup, builds the Tilt pitch flyer, returns
 *   the row.
 */
export const maxDuration = 300;

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ ok: true, socks: [] });
  const rows = await db.select().from(sockDesigns).orderBy(desc(sockDesigns.createdAt));
  return NextResponse.json({ ok: true, socks: rows });
}

type PostBody = {
  orgName?: string;
  colors?: string;
  note?: string;
  logoBase64?: string;
  logoMime?: string;
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
          "Preview mode — sock designs need a database, Claude, Gemini, and Blob configured in Vercel.",
      },
      { status: 400 },
    );
  }

  const orgName = body.orgName?.trim();
  if (!orgName) {
    return NextResponse.json({ ok: false, error: "Organization name is required." }, { status: 400 });
  }
  if (!body.logoBase64) {
    return NextResponse.json({ ok: false, error: "Upload the org logo." }, { status: 400 });
  }

  try {
    // 1) The uploaded logo goes to Blob first (render fetches it back).
    const logoUrl = await mirrorToBlob({
      key: `socks/sources/${Date.now()}-${orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      buffer: Buffer.from(body.logoBase64, "base64"),
      contentType: body.logoMime || "image/png",
    });

    // 2) The brain writes the pitch copy.
    const pitch = await writeSockPitch(
      orgName,
      body.colors?.trim() || undefined,
      body.note?.trim() || undefined,
    );

    const rows = await db
      .insert(sockDesigns)
      .values({
        orgName,
        colors: body.colors?.trim() || null,
        note: body.note?.trim() || null,
        logoUrl,
        copy: pitch.copy,
        hashtags: pitch.hashtags,
        cta: pitch.cta,
        graphicLine: pitch.graphicLine,
      })
      .returning();
    const row = rows[0];

    // 3) Design the sock mockup, then build the pitch flyer around it.
    const designUrl = await renderSockDesign(row);
    const flyerUrl = await renderSockFlyer({ ...row, designUrl });

    return NextResponse.json({ ok: true, sock: { ...row, designUrl, flyerUrl } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
