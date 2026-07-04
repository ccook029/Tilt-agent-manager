import { ne, sql } from "drizzle-orm";
import { db } from "@/lib/social/db";
import { posts } from "@/lib/social/db/schema";

/**
 * The calendar never sits in the past. If days go by without posting, the
 * whole un-published queue slides forward so the earliest pending piece lands
 * on today — relative spacing (the cadence) is preserved, nothing is lost,
 * and no AI credits are spent: copy, approvals, and rendered images all
 * carry over unchanged.
 *
 * Runs cheaply on page load (one MIN() query; an UPDATE only when behind).
 */
export async function rollForwardSchedule(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({ min: sql<string | null>`min(${posts.scheduledDate})` })
    .from(posts)
    .where(ne(posts.status, "published"));
  const earliest = rows[0]?.min;
  if (!earliest || earliest >= today) return 0;

  const days = Math.round((Date.parse(today) - Date.parse(earliest)) / 86_400_000);
  await db
    .update(posts)
    .set({
      scheduledDate: sql`${posts.scheduledDate} + ${days}::int`,
      updatedAt: sql`now()`,
    })
    .where(ne(posts.status, "published"));
  return days;
}
