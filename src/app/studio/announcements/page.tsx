import { desc } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { announcements, type Announcement } from "@/lib/social/db/schema";
import { isDemoMode } from "@/lib/social/demo-data";
import { adminTokenConfigured } from "@/lib/social/admin-auth";
import AnnouncementsBoard from "./AnnouncementsBoard";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  let rows: Announcement[] = [];
  let error: string | null = null;
  try {
    if (!isDemoMode()) {
      rows = await db.select().from(announcements).orderBy(desc(announcements.createdAt));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <AnnouncementsBoard
      initial={rows}
      demo={isDemoMode()}
      adminProtected={adminTokenConfigured()}
      loadError={error}
    />
  );
}
