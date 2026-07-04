import { NextResponse } from "next/server";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";

/**
 * One-time helper for the no-terminal Zoho WorkDrive setup.
 *
 * Takes the Self Client credentials + a freshly generated grant code and
 * exchanges them for a long-lived refresh token, which the founder then pastes
 * into Vercel as ZOHO_REFRESH_TOKEN. This avoids needing a curl/terminal step.
 *
 * Nothing is stored — the refresh token is returned to the caller only.
 */
export async function POST(req: Request) {
  let body: {
    accountsDomain?: string;
    clientId?: string;
    clientSecret?: string;
    code?: string;
    token?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }

  const auth = checkAdminToken(tokenFromRequest(req, body));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  const { accountsDomain, clientId, clientSecret, code } = body;
  if (!clientId || !clientSecret || !code) {
    return NextResponse.json(
      { ok: false, error: "clientId, clientSecret and code are all required." },
      { status: 400 },
    );
  }

  const domain = (accountsDomain || "https://accounts.zoho.com").replace(
    /\/$/,
    "",
  );

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });

  try {
    const res = await fetch(`${domain}/oauth/v2/token?${params}`, {
      method: "POST",
    });
    const data = (await res.json()) as {
      refresh_token?: string;
      access_token?: string;
      error?: string;
    };

    if (!data.refresh_token) {
      return NextResponse.json(
        {
          ok: false,
          error:
            data.error === "invalid_code"
              ? "The grant code is invalid or already used/expired. Generate a fresh code in the Zoho console and try again within its validity window."
              : `Zoho returned no refresh token: ${data.error ?? "unknown error"}`,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      refreshToken: data.refresh_token,
      message:
        "Copy this refresh token into Vercel as ZOHO_WORKDRIVE_REFRESH_TOKEN (or ZOHO_REFRESH_TOKEN if WorkDrive shares the same Zoho app), then redeploy.",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
