import { NextResponse } from "next/server";
import { hasDatabase, hasBlob } from "@/lib/social/env";

export async function GET() {
  const checks = {
    database: hasDatabase(),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    blob: hasBlob(),
    workdrive: Boolean(
      process.env.ZOHO_REFRESH_TOKEN &&
        process.env.ZOHO_CLIENT_ID &&
        process.env.ZOHO_CLIENT_SECRET,
    ),
  };
  return NextResponse.json({ ok: true, checks });
}
