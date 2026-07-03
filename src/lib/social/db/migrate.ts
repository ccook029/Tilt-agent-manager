import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies generated SQL migrations from ./drizzle.
 * Run: `npm run db:generate` (after schema changes) then `npm run db:migrate`.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const migrationClient = postgres(url, { max: 1 });
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
