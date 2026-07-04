import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { resolveDatabaseUrl } from "@/lib/social/env";

/**
 * Applies generated SQL migrations from ./drizzle.
 * Run: `npm run db:generate` (after schema changes) then `npm run db:migrate`.
 */
async function main() {
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      "No database URL set (DATABASE_URL / POSTGRES_URL / …). See .env.example.",
    );
  }

  const migrationClient = postgres(url, {
    max: 1,
    ssl: /sslmode=disable/i.test(url) || /@(localhost|127\.0\.0\.1)[:/]/i.test(url)
      ? undefined
      : "require",
  });
  const dbm = drizzle(migrationClient);

  console.log("Running migrations…");
  await migrate(dbm, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  await migrationClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
