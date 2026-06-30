// ---------------------------------------------------------------------------
// /api/zoho/exchange-token — One-time, no-terminal helper to mint a Zoho
// refresh token from a Self Client grant code.
//
// Why this exists: exchanging a Zoho grant code for a refresh token normally
// means running a curl command. This route does it server-side using the
// ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET already configured in the environment, so
// the only thing the user supplies is the short-lived grant code — pasted into
// a simple web form. The resulting refresh token is shown so it can be copied
// into the ZOHO_REFRESH_TOKEN env var.
//
// Security: gated behind CRON_SECRET when that env var is set. The grant code
// is single-use and expires in minutes, and the client secret never leaves the
// server. Safe to delete this file once setup is done.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function html(body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zoho Token Helper</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d0d0d;color:#e5e5e5;max-width:640px;margin:0 auto;padding:32px 20px;line-height:1.6}
  h1{font-size:22px;color:#00d6ff}
  label{display:block;font-size:13px;color:#9ca3af;margin:16px 0 6px}
  input,textarea{width:100%;box-sizing:border-box;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#e5e5e5;padding:10px 12px;font-size:14px;font-family:inherit}
  textarea{min-height:64px}
  button{margin-top:20px;background:#00d6ff;color:#06232b;border:0;border-radius:8px;padding:11px 22px;font-size:15px;font-weight:600;cursor:pointer}
  .box{background:#11261c;border:1px solid #1f5; border-radius:8px;padding:14px;word-break:break-all;font-family:monospace;font-size:13px;color:#9effc0;margin-top:10px}
  .err{background:#2a1212;border:1px solid #a33;color:#ffb4b4;border-radius:8px;padding:14px;margin-top:10px}
  .muted{color:#8a8a8a;font-size:13px}
  code{background:#1a1a1a;padding:2px 6px;border-radius:4px;color:#cdd}
  ol{padding-left:20px}
</style></head><body>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function formPage(opts: { needKey: boolean; message?: string }): NextResponse {
  return html(`
    <h1>Zoho Refresh Token Helper</h1>
    <p class="muted">Paste the <strong>grant code</strong> from the Zoho API Console (Self Client &rarr; Generate Code) and submit. This trades it for a long-lived refresh token using the Client ID/Secret already configured on the server.</p>
    ${opts.message ? `<div class="err">${opts.message}</div>` : ""}
    <form method="POST">
      <label>Grant code (from Zoho, expires in ~10 min, single use)</label>
      <textarea name="code" placeholder="1000.abc123..." required></textarea>
      ${opts.needKey ? `<label>Setup key (your CRON_SECRET from Vercel)</label><input name="key" type="password" placeholder="CRON_SECRET value" />` : ""}
      <button type="submit">Get refresh token</button>
    </form>
    <p class="muted" style="margin-top:24px">After you get the token: copy it into <code>ZOHO_REFRESH_TOKEN</code> in Vercel &rarr; Settings &rarr; Environment Variables, then redeploy.</p>
  `);
}

export async function GET() {
  const needKey = !!process.env.CRON_SECRET;
  return formPage({ needKey });
}

export async function POST(req: NextRequest) {
  const needKey = !!process.env.CRON_SECRET;

  let code = "";
  let key = "";
  try {
    const form = await req.formData();
    code = String(form.get("code") ?? "").trim();
    key = String(form.get("key") ?? "").trim();
  } catch {
    return formPage({ needKey, message: "Could not read the form. Try again." });
  }

  if (needKey && key !== process.env.CRON_SECRET) {
    return formPage({ needKey, message: "Setup key didn't match your CRON_SECRET. Find it in Vercel → Settings → Environment Variables." });
  }
  if (!code) {
    return formPage({ needKey, message: "Please paste the grant code." });
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return formPage({
      needKey,
      message: "ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET are not set on the server. Add them in Vercel first.",
    });
  }

  const accountsUrl = process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com";
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });

  let data: Record<string, unknown> = {};
  try {
    const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return formPage({
      needKey,
      message: `Network error contacting Zoho: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : "";

  if (!refreshToken) {
    const reason =
      (typeof data.error === "string" && data.error) ||
      "No refresh_token was returned. The grant code was likely already used or expired — generate a fresh one in Zoho and try again. (A refresh token is only returned the first time a code is exchanged.)";
    return html(`
      <h1>Zoho Refresh Token Helper</h1>
      <div class="err"><strong>Couldn't get a refresh token.</strong><br>${reason}</div>
      <p class="muted">Zoho's full response:</p>
      <div class="box">${escapeHtml(JSON.stringify(data, null, 2))}</div>
      <p style="margin-top:20px"><a href="" style="color:#00d6ff">&larr; Try again</a></p>
    `, 400);
  }

  return html(`
    <h1>✅ Refresh token created</h1>
    <p>Copy this value into <code>ZOHO_REFRESH_TOKEN</code> in Vercel &rarr; Settings &rarr; Environment Variables, then redeploy.</p>
    <div class="box">${escapeHtml(refreshToken)}</div>
    <p class="muted" style="margin-top:20px">This token does not expire (the app refreshes access tokens from it automatically). Keep it secret. Once it's saved in Vercel, you can delete the <code>src/app/api/zoho/exchange-token</code> route — it's only needed for setup.</p>
  `);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
