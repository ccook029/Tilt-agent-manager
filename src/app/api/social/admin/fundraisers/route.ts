import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { fundraisers } from "@/lib/social/db/schema";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { mirrorToBlob } from "@/lib/social/blob";
import { writeFundraiserCopy, renderFundraiser } from "@/lib/social/fundraiser/generate";

/**
 * Blanket fundraisers (team pre-order posts).
 *
 * GET  -> list, newest first.
 * POST -> create + fully generate one:
 *   { orgName, deadline (YYYY-MM-DD), paymentEmail?, note?, blanketBase64, blanketMime, token? }
 *   blanketBase64 is the finished blanket rendering. Uploads it to Blob, has the
 *   brain write the uniform caption, renders + composites the flyer, returns the row.
 */
export const maxDuration = 300;

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ ok: true, fundraisers: [] });
  const rows = await db
    .select()
    .from(fundraisers)
    .orderBy(desc(fundraisers.createdAt));
  return NextResponse.json({ ok: true, fundraisers: rows });
}

type PostBody = {
  orgName?: string;
  deadline?: string;
  paymentEmail?: string;
  note?: string;
  blanketBase64?: string;
  blanketMime?: string;
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
          "Preview mode — fundraisers need a database, Claude, Gemini, and Blob configured in Vercel.",
      },
      { status: 400 },
    );
  }

  const orgName = body.orgName?.trim();
  if (!orgName) {
    return NextResponse.json({ ok: false, error: "Organization name is required." }, { status: 400 });
  }
  const deadline = body.deadline?.trim();
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return NextResponse.json(
      { ok: false, error: "A valid pre-order deadline (date) is required." },
      { status: 400 },
    );
  }
  if (!body.blanketBase64) {
    return NextResponse.json(
      { ok: false, error: "Upload the blanket image." },
      { status: 400 },
    );
  }

  try {
    // 1) The uploaded blanket image goes to Blob first (render fetches it back).
    const blanketUrl = await mirrorToBlob({
      key: `fundraisers/sources/${Date.now()}-${orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      buffer: Buffer.from(body.blanketBase64, "base64"),
      contentType: body.blanketMime || "image/png",
    });

    // 2) The brain writes the uniform caption.
    const copy = await writeFundraiserCopy(
      orgName,
      deadline,
      body.paymentEmail?.trim() || undefined,
      body.note?.trim() || undefined,
    );

    const rows = await db
      .insert(fundraisers)
      .values({
        orgName,
        paymentEmail: body.paymentEmail?.trim() || null,
        deadline,
        note: body.note?.trim() || null,
        blanketUrl,
        copy: copy.copy,
        hashtags: copy.hashtags,
        cta: copy.cta,
        graphicLine: copy.graphicLine,
      })
      .returning();
    const row = rows[0];

    // 3) Generate + composite the flyer (TILT wordmark by code).
    const imageUrl = await renderFundraiser(row);

    return NextResponse.json({ ok: true, fundraiser: { ...row, imageUrl } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
