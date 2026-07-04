import { desc } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { sockDesigns, type SockDesign } from "@/lib/social/db/schema";
import { isDemoMode } from "@/lib/social/demo-data";
import { adminTokenConfigured } from "@/lib/social/admin-auth";
import SocksBoard from "./SocksBoard";

export const dynamic = "force-dynamic";

export default async function SocksPage() {
  let rows: SockDesign[] = [];
  let error: string | null = null;
  try {
    if (!isDemoMode()) {
      rows = await db.select().from(sockDesigns).orderBy(desc(sockDesigns.createdAt));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <SocksBoard
      initial={rows}
      demo={isDemoMode()}
      adminProtected={adminTokenConfigured()}
      loadError={error}
    />
  );
}
