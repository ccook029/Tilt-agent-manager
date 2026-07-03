// ---------------------------------------------------------------------------
// /api/modules/launch?m=<module> — one front door for every Tilt tool.
//
// Mirrors the proven Catalog Builder pattern: the dashboard links here, and
// this server-side route redirects to the module's deployed URL, appending its
// access key when one is configured (keys stay server-only, never in the
// client bundle). Add a module = two env vars, zero code in the satellite
// until it wants to enforce the key.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

const MODULES: Record<string, { urlEnv: string; keyEnv: string; label: string }> = {
  social: {
    urlEnv: "SOCIAL_APP_URL",
    keyEnv: "SOCIAL_ACCESS_KEY",
    label: "Tilt Social Studio",
  },
  webadmin: {
    urlEnv: "WEBADMIN_APP_URL",
    keyEnv: "WEBADMIN_ACCESS_KEY",
    label: "Tilt Web Admin",
  },
  inventory: {
    urlEnv: "INVENTORY_APP_URL",
    keyEnv: "INVENTORY_ACCESS_KEY",
    label: "Tilt Inventory",
  },
};

export async function GET(request: NextRequest) {
  const m = request.nextUrl.searchParams.get("m") ?? "";
  const mod = MODULES[m];
  if (!mod) {
    return NextResponse.json(
      { error: `Unknown module "${m}". Valid: ${Object.keys(MODULES).join(", ")}` },
      { status: 400 }
    );
  }

  const base = process.env[mod.urlEnv];
  if (!base) {
    return new NextResponse(
      `<!doctype html><body style="font-family:sans-serif;background:#0d0d0d;color:#e5e5e5;padding:40px;max-width:560px;margin:0 auto">
      <h2 style="color:#00d6ff">${mod.label} isn't linked yet</h2>
      <p>Set <code style="background:#222;padding:2px 6px;border-radius:4px">${mod.urlEnv}</code> in Vercel → Settings → Environment Variables to this module's deployed URL, then redeploy. Optional: set <code style="background:#222;padding:2px 6px;border-radius:4px">${mod.keyEnv}</code> to pass a shared access key on launch.</p>
      </body>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const key = process.env[mod.keyEnv];
  const target = key
    ? `${base}${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`
    : base;
  return NextResponse.redirect(target);
}
