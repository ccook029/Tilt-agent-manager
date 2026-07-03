import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { resolveDatabaseUrl } from "@/lib/social/env";

/**
 * Lazy Postgres connection. The client is only created on first use so that
 * building/collecting page data (which imports modules) does not require
 * DATABASE_URL to be set. In serverless we keep the pool small and cache the
 * client across hot invocations via globalThis.
 */
const globalForDb = globalThis as unknown as {
  __tiltSql?: ReturnType<typeof postgres>;
  __tiltDb?: PostgresJsDatabase<typeof schema>;
};

function getConnectionString(): string {
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      "No database URL set. Add a Postgres store in Vercel (Storage tab) or set DATABASE_URL.",
    );
  }
  return url;
}

export function getSql(): ReturnType<typeof postgres> {
  if (!globalForDb.__tiltSql) {
    globalForDb.__tiltSql = postgres(getConnectionString(), {
      max: 5,
      idle_timeout: 20,
      // Neon/Supabase require SSL; the connection string carries sslmode=require.
    });
  }
  return globalForDb.__tiltSql;
}

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!globalForDb.__tiltDb) {
    globalForDb.__tiltDb = drizzle(getSql(), { schema });
  }
  return globalForDb.__tiltDb;
}

/**
 * `db` is a Proxy that defers connection creation until a query method is
 * actually invoked — safe to import at module scope.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export { schema };
