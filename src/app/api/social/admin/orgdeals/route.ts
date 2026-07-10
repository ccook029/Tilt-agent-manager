import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { orgStickDeals } from "@/lib/social/db/schema";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { mirrorToBlob } from "@/lib/social/blob";
import {
  writeOrgDealContent,
  renderOrgDealGraphics,
  renderOrgDealPitch,
  defaultDeliveryDate,
} from "@/lib/social/orgdeal/generate";

/**
 * Org stick programs (the organization pitch engine).
 *
 * GET  -> list, newest first.
 * POST -> create + fully generate one:
 *   { orgName, deadline (YYYY-MM-DD), logoBase64, logoMime,
 *     orderUrl?, discountPct?, kickbackPct?, deliveryDate?, contactName?,
 *     accentColor?, note?, token? }
 *   Uploads the crest to Blob, has the brain write the pitch + member email +
 *   MAP-safe social caption, composites the graphics (4:5/1:1/9:16) and the
 *   pitch one-pager PDF, returns the row.
 */
export const maxDuration = 300;

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ ok: true, orgDeals: [] });
  const rows = await db
    .select()
    .from(orgStickDeals)
    .orderBy(desc(orgStickDeals.createdAt));
  return NextResponse.json({ ok: true, orgDeals: rows });
}

type PostBody = {
  orgName?: string;
  deadline?: string;
  deliveryDate?: string;
  orderUrl?: string;
  discountPct?: number;
  kickbackPct?: number;
  contactName?: string;
  accentColor?: string;
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
          "Preview mode — org programs need a database, Claude, and Blob configured in Vercel.",
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
      { ok: false, error: "A valid order deadline (date) is required." },
      { status: 400 },
    );
  }
  if (!body.logoBase64) {
    return NextResponse.json(
      { ok: false, error: "Upload the organization's logo/crest." },
      { status: 400 },
    );
  }
  const discountPct = Math.round(Number(body.discountPct ?? 15));
  const kickbackPct = Math.round(Number(body.kickbackPct ?? 10));
  if (
    !Number.isFinite(discountPct) || discountPct <= 0 || discountPct > 100 ||
    !Number.isFinite(kickbackPct) || kickbackPct < 0 || kickbackPct > 100
  ) {
    return NextResponse.json(
      { ok: false, error: "Discount/kickback must be sensible percentages." },
      { status: 400 },
    );
  }
  const deliveryDate =
    body.deliveryDate?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDate.trim())
      ? body.deliveryDate.trim()
      : defaultDeliveryDate(deadline);

  try {
    // 1) The crest goes to Blob first (renders fetch it back).
    const logoUrl = await mirrorToBlob({
      key: `orgdeals/sources/${Date.now()}-${orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      buffer: Buffer.from(body.logoBase64, "base64"),
      contentType: body.logoMime || "image/png",
    });

    // 2) The brain writes the whole package (pitch / email / social).
    const content = await writeOrgDealContent({
      orgName,
      discountPct,
      kickbackPct,
      deadline,
      deliveryDate,
      orderUrl: body.orderUrl?.trim() || null,
      contactName: body.contactName?.trim() || null,
      note: body.note?.trim() || null,
    });

    const rows = await db
      .insert(orgStickDeals)
      .values({
        orgName,
        orderUrl: body.orderUrl?.trim() || null,
        logoUrl,
        accentColor: body.accentColor?.trim() || null,
        discountPct,
        kickbackPct,
        deadline,
        deliveryDate,
        contactName: body.contactName?.trim() || null,
        note: body.note?.trim() || null,
        copy: content.social.copy,
        hashtags: content.social.hashtags,
        cta: content.social.cta,
        graphicLine: content.social.graphicLine,
        emailSubject: content.email.subject,
        emailBody: content.email.body,
        pitch: content.pitch,
      })
      .returning();
    const row = rows[0];

    // 3) Composite the graphics + render the pitch PDF (marks stamped by code),
    // then re-read the row so the response carries every generated URL.
    await renderOrgDealGraphics(row);
    await renderOrgDealPitch(row);
    const fresh = await db
      .select()
      .from(orgStickDeals)
      .where(eq(orgStickDeals.id, row.id))
      .limit(1);

    return NextResponse.json({ ok: true, orgDeal: fresh[0] ?? row });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
