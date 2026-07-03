import { NextResponse } from "next/server";
import { workdriveEnv } from "@/lib/social/workdrive";

export async function GET() {
  const checks = {
    database: Boolean(process.env.DATABASE_URL) || Boolean(process.env.POSTGRES_URL),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    workdrive: Boolean(
      workdriveEnv("REFRESH_TOKEN") && workdriveEnv("CLIENT_ID"),
    ),
  };
  return NextResponse.json({ ok: true, phase: 1, checks });
}
