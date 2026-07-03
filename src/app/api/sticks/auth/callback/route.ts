// ---------------------------------------------------------------------------
// GET /api/sticks/auth/callback — one-time Zoho OAuth setup helper for the
// Stick Inventory module. Ported from tiltinventory's /api/auth/callback:
// register this URL as the redirect URI on the Zoho self client, visit the
// authorize URL, and this page shows the code + the curl to exchange it for
// a refresh token.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json(
      { error: "No authorization code received" },
      { status: 400 }
    );
  }

  // Display the code so the user can exchange it for tokens
  return new NextResponse(
    `<html>
      <head><title>Zoho Authorization</title></head>
      <body style="font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
        <h1>Authorization Code Received</h1>
        <p>Your authorization code is:</p>
        <pre style="background: #f0f0f0; padding: 15px; border-radius: 8px; word-break: break-all;">${code}</pre>
        <p>Run this command to get your refresh token:</p>
        <pre style="background: #f0f0f0; padding: 15px; border-radius: 8px; font-size: 12px; overflow-x: auto;">
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \\
  -d "code=${code}" \\
  -d "client_id=YOUR_CLIENT_ID" \\
  -d "client_secret=YOUR_CLIENT_SECRET" \\
  -d "redirect_uri=http://localhost:3000/api/sticks/auth/callback" \\
  -d "grant_type=authorization_code"</pre>
        <p>Copy the <code>refresh_token</code> from the response into your <code>.env.local</code> file.</p>
      </body>
    </html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
