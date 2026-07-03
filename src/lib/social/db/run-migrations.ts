import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { join } from "node:path";
import { resolveDatabaseUrl } from "@/lib/social/env";

/**
 * Applies the generated SQL migrations from ./drizzle. Shared by the CLI
 * (src/lib/db/migrate.ts) and the web "Initialize database" button
 * (/api/admin/migrate) so the founder never has to touch a terminal.
 */
export async function runMigrations(): Promise<{ applied: true }> {
  const url = resolveDatabaseUrl();
  if (!url) throw new Error("No database URL set (add a Postgres store in Vercel).");

  const client = postgres(url, { max: 1 });
  try {
    const dbm = drizzle(client);
    await migrate(dbm, {
      migrationsFolder: join(process.cwd(), "drizzle"),
    });
    return { applied: true };
  } finally {
    await client.end();
  }
}
