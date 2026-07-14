// ---------------------------------------------------------------------------
// auth.ts — Tilt Design Portal session
//
// One shared passcode (PORTAL_PASSCODE) gates the whole portal. A successful
// login mints a compact HMAC token (`portal.<expiryEpoch>.<hmacSha256Hex>`)
// stored in an httpOnly cookie — the same scheme as the agent manager's
// os-auth.ts, simplified to a single anonymous designer identity.
//
// Web Crypto only (no Node `crypto`) so the exact same code runs in the edge
// middleware and in Node route handlers.
// ---------------------------------------------------------------------------

export const PORTAL_COOKIE = "tilt_portal_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** The portal is locked until PORTAL_PASSCODE is configured. */
export function portalConfigured(): boolean {
  return Boolean(process.env.PORTAL_PASSCODE);
}

function sessionSecret(): string {
  // A dedicated secret is preferred; fall back to the passcode itself so a
  // single env var is enough to run the portal. Rotating either invalidates
  // existing sessions.
  const secret = process.env.PORTAL_SESSION_SECRET || process.env.PORTAL_PASSCODE;
  if (!secret) throw new Error("PORTAL_PASSCODE is not set");
  return secret;
}

async function hmacHex(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function mintPortalToken(ttlSeconds = SESSION_TTL_SECONDS): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `portal.${expiry}`;
  return `${payload}.${await hmacHex(payload)}`;
}

/** True when the token is present, well-formed, correctly signed, and unexpired. */
export async function verifyPortalToken(token: string | undefined | null): Promise<boolean> {
  if (!token || !portalConfigured()) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "portal") return false;
  const [, expiryStr, signature] = parts;
  const payload = `portal.${expiryStr}`;
  if (!safeEqual(signature, await hmacHex(payload))) return false;
  return Number(expiryStr) >= Math.floor(Date.now() / 1000);
}

export const portalCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
