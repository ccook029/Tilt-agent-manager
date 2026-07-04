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

/**
 * Decide SSL. Neon/Supabase require TLS, but a copy-pasted pooler URL often
 * omits `sslmode=require`, and postgres.js does NOT enable TLS unless told to.
 * So we default remote hosts to `require` rather than trusting the URL — while
 * still honouring an explicit `sslmode=disable` and leaving plain local dev
 * (localhost) untouched.
 */
function sslSetting(url: string): "require" | undefined {
  if (/sslmode=disable/i.test(url)) return undefined;
  if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(url)) return undefined;
  return "require";
}

export function getSql(): ReturnType<typeof postgres> {
  if (!globalForDb.__tiltSql) {
    const url = getConnectionString();
    globalForDb.__tiltSql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      ssl: sslSetting(url),
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
