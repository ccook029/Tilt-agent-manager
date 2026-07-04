/**
 * Environment resolution.
 *
 * When you create a Postgres store from inside Vercel (Storage tab), Vercel
 * auto-injects the connection string — but the exact var name varies by provider
 * (DATABASE_URL, POSTGRES_URL, POSTGRES_PRISMA_URL, …). We accept any of them so
 * the founder never has to copy/paste a connection string by hand.
 */

const DB_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
] as const;

export function resolveDatabaseUrl(): string | undefined {
  for (const k of DB_URL_KEYS) {
    const v = process.env[k];
    if (v && v.trim()) return v;
  }
  return undefined;
}

export function hasDatabase(): boolean {
  return Boolean(resolveDatabaseUrl());
}

/**
 * Whether Vercel Blob is usable. Two connection styles both work with the
 * @vercel/blob SDK (v2): a classic read-write token, OR an OIDC connection
 * (the dashboard default) where the deployment gets VERCEL_OIDC_TOKEN at runtime
 * and the store is identified by BLOB_STORE_ID. The SDK auto-resolves either, so
 * presence of *either* signal means Blob is configured.
 */
export function hasBlob(): boolean {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const storeId = process.env.BLOB_STORE_ID;
  return Boolean((token && token.trim()) || (storeId && storeId.trim()));
}
