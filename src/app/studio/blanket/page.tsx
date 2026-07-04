import { desc } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { fundraisers, type Fundraiser } from "@/lib/social/db/schema";
import { isDemoMode } from "@/lib/social/demo-data";
import { adminTokenConfigured } from "@/lib/social/admin-auth";
import FundraisersBoard from "./FundraisersBoard";

export const dynamic = "force-dynamic";

export default async function FundraisersPage() {
  let rows: Fundraiser[] = [];
  let error: string | null = null;
  try {
    if (!isDemoMode()) {
      rows = await db.select().from(fundraisers).orderBy(desc(fundraisers.createdAt));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <FundraisersBoard
      initial={rows}
      demo={isDemoMode()}
      adminProtected={adminTokenConfigured()}
      loadError={error}
    />
  );
}
