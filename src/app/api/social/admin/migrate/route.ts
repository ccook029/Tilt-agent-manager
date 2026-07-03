import { NextResponse } from "next/server";
import { runMigrations } from "@/lib/social/db/run-migrations";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";

/**
 * Web "Initialize database" action — creates all tables by applying the
 * generated migrations. Safe to run repeatedly (already-applied migrations are
 * skipped).
 */
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: { token?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const auth = checkAdminToken(tokenFromRequest(req, body));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  try {
    await runMigrations();
    return NextResponse.json({ ok: true, message: "Database initialized." });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
