import { NextResponse } from "next/server";
import { getCatalogStats } from "@/lib/social/queries";
import { adminTokenConfigured } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { hasDatabase } from "@/lib/social/env";
import { workdriveEnv } from "@/lib/social/workdrive";

/**
 * Status for the /setup page: which secrets are configured, whether the
 * database has been initialized, and how many assets are catalogued so far.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const secrets = {
    database: hasDatabase(),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    workdrive: Boolean(
      workdriveEnv("REFRESH_TOKEN") &&
        workdriveEnv("CLIENT_ID") &&
        workdriveEnv("CLIENT_SECRET"),
    ),
  };

  const demo = isDemoMode();
  let dbInitialized = false;
  let stats: Awaited<ReturnType<typeof getCatalogStats>> | null = null;
  let dbError: string | null = null;

  if (demo) {
    // No database — serve the built-in sample catalog stats.
    stats = await getCatalogStats();
  } else if (secrets.database) {
    try {
      stats = await getCatalogStats();
      dbInitialized = true;
    } catch (e) {
      // Most likely: tables not created yet ("relation assets does not exist").
      dbError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({
    ok: true,
    phase: 1,
    demoMode: demo,
    secrets,
    adminProtected: adminTokenConfigured(),
    dbInitialized,
    dbError,
    stats,
  });
}

