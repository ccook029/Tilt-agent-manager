import { NextResponse } from "next/server";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { generateStudioAsset, type StudioInput } from "@/lib/social/studio/generate";

/**
 * Studio generation — produces a freeform, on-brand piece (desktop background,
 * wallpaper, poster, …) from a plain-language request. Composes the brief with
 * Claude (when ANTHROPIC_API_KEY is set), renders with Nano Banana Pro, then
 * composites the TILT logo in code. Needs DATABASE_URL, BLOB_READ_WRITE_TOKEN,
 * and GEMINI_API_KEY.
 *
 * Body: { prompt, preset?, width?, height?, baseAssetId?, withLogo?, token? }
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: StudioInput & { token?: string } = { prompt: "" };
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const auth = checkAdminToken(tokenFromRequest(req, body));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  if (!body.prompt || !body.prompt.trim()) {
    return NextResponse.json(
      { ok: false, error: "Describe what you want to make." },
      { status: 400 },
    );
  }

  if (isDemoMode()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Preview mode — no database. Add DATABASE_URL, BLOB_READ_WRITE_TOKEN, and GEMINI_API_KEY in Vercel to generate.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await generateStudioAsset({
      prompt: body.prompt,
      preset: body.preset,
      width: body.width,
      height: body.height,
      baseAssetId: body.baseAssetId,
      withLogo: body.withLogo,
    });
    return NextResponse.json({
      ok: true,
      asset: result.asset,
      brief: result.brief,
      source: result.source,
      safety: result.safety,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
