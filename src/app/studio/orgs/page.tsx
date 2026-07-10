import { desc } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { orgStickDeals, type OrgStickDeal } from "@/lib/social/db/schema";
import { isDemoMode } from "@/lib/social/demo-data";
import { adminTokenConfigured } from "@/lib/social/admin-auth";
import OrgDealsBoard from "./OrgDealsBoard";

export const dynamic = "force-dynamic";

export default async function OrgDealsPage() {
  let rows: OrgStickDeal[] = [];
  let error: string | null = null;
  try {
    if (!isDemoMode()) {
      rows = await db.select().from(orgStickDeals).orderBy(desc(orgStickDeals.createdAt));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <OrgDealsBoard
      initial={rows}
      demo={isDemoMode()}
      adminProtected={adminTokenConfigured()}
      loadError={error}
    />
  );
}
