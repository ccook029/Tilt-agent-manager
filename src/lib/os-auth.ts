// ---------------------------------------------------------------------------
// os-auth.ts — Tilt OS staff session (docs/OS_LOGIN_DESIGN.md)
//
// One staff identity across every Tilt tool. Tokens are compact HMAC strings
// (`os.<staffId>.<expiryEpoch>.<hmacSha256Hex>`) signed with the shared
// TILT_OS_SESSION_SECRET — the same scheme as tiltweb's staff login, with a
// distinct prefix and a dedicated secret. tiltweb is the identity provider
// (it holds the admin_users credentials); this module only mints/verifies.
//
// Web Crypto only (no Node `crypto`) so the exact same code runs in the edge
// middleware and in Node route handlers.
// ---------------------------------------------------------------------------

export const OS_COOKIE = "tilt_os_session";
export const OS_SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h, matches tiltweb staff sessions

/** Staff id used ONLY by the transitional shared-passcode fallback login
 * (OS_SHARED_PASSCODE). tiltweb never issues OS tokens for this id. */
export const SHARED_STAFF_ID = 0;

export function osAuthEnabled(): boolean {
  return Boolean(process.env.TILT_OS_SESSION_SECRET);
}

async function hmacHex(payload: string): Promise<string> {
  const secret = process.env.TILT_OS_SESSION_SECRET;
  if (!secret) throw new Error("TILT_OS_SESSION_SECRET is not set");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish string compare (both sides are fixed-length hex here). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function mintOsToken(
  staffId: number,
  ttlSeconds = OS_SESSION_TTL_SECONDS
): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `os.${staffId}.${expiry}`;
  return `${payload}.${await hmacHex(payload)}`;
}

/** Returns the staff id, or null when missing/forged/expired. */
export async function verifyOsToken(
  token: string | undefined | null
): Promise<number | null> {
  if (!token || !osAuthEnabled()) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "os") return null;
  const [, idStr, expiryStr, signature] = parts;
  const payload = `os.${idStr}.${expiryStr}`;
  if (!safeEqual(signature, await hmacHex(payload))) return null;
  if (Number(expiryStr) < Math.floor(Date.now() / 1000)) return null;
  const id = Number(idStr);
  return Number.isInteger(id) ? id : null;
}

export const osCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: OS_SESSION_TTL_SECONDS,
};
