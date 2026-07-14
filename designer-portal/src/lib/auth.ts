// ---------------------------------------------------------------------------
// auth.ts — Tilt Design Portal sessions
//
// Users are configured in the PORTAL_USERS env var — comma- or
// newline-separated `email:password` pairs, no database needed:
//   PORTAL_USERS="gino@example.com:secret1, someone@tilt.com:secret2"
// PORTAL_PASSCODE still works as a shared team passcode alongside it.
//
// A successful login mints a compact HMAC token
// (`portal.<base64url(email)>.<expiryEpoch>.<hmacSha256Hex>`) stored in an
// httpOnly cookie — the same scheme as the agent manager's os-auth.ts.
//
// Web Crypto only (no Node `crypto`) so the exact same code runs in the edge
// middleware and in Node route handlers.
// ---------------------------------------------------------------------------

export const PORTAL_COOKIE = "tilt_portal_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Identity recorded for logins that used the shared PORTAL_PASSCODE. */
export const SHARED_USER = "team";

export type PortalUser = { email: string; password: string };

export function portalUsers(): PortalUser[] {
  return (process.env.PORTAL_USERS ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const i = entry.indexOf(":");
      if (i <= 0 || i === entry.length - 1) return [];
      return [{ email: entry.slice(0, i).trim().toLowerCase(), password: entry.slice(i + 1) }];
    });
}

/** The portal is locked until at least one login is configured. */
export function portalConfigured(): boolean {
  return portalUsers().length > 0 || Boolean(process.env.PORTAL_PASSCODE);
}

function sessionSecret(): string {
  // A dedicated secret is preferred; fall back to the credential material so
  // configuring users is enough to run the portal. Rotating any of these
  // invalidates existing sessions.
  const secret =
    process.env.PORTAL_SESSION_SECRET ||
    process.env.PORTAL_PASSCODE ||
    process.env.PORTAL_USERS;
  if (!secret) throw new Error("No portal login is configured");
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

/**
 * Checks credentials against PORTAL_USERS, then the shared PORTAL_PASSCODE.
 * Returns the identity to record in the session, or null when rejected.
 */
export function validateLogin(email: string, passcode: string): string | null {
  const normalized = email.trim().toLowerCase();
  let matched: string | null = null;
  for (const user of portalUsers()) {
    // Always compare the password so timing doesn't reveal which emails exist.
    const passwordOk = safeEqual(passcode, user.password);
    if (user.email === normalized && passwordOk) matched = user.email;
  }
  if (matched) return matched;

  const shared = process.env.PORTAL_PASSCODE;
  if (shared && safeEqual(passcode, shared)) return normalized || SHARED_USER;
  return null;
}

// base64url without padding — keeps the email token-safe (no "." collisions).
function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(encoded: string): string | null {
  try {
    const bin = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export async function mintPortalToken(
  user: string,
  ttlSeconds = SESSION_TTL_SECONDS
): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `portal.${b64urlEncode(user)}.${expiry}`;
  return `${payload}.${await hmacHex(payload)}`;
}

/** Returns the signed-in identity, or null when missing/forged/expired. */
export async function verifyPortalToken(
  token: string | undefined | null
): Promise<string | null> {
  if (!token || !portalConfigured()) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "portal") return null;
  const [, userB64, expiryStr, signature] = parts;
  const payload = `portal.${userB64}.${expiryStr}`;
  if (!safeEqual(signature, await hmacHex(payload))) return null;
  if (Number(expiryStr) < Math.floor(Date.now() / 1000)) return null;
  return b64urlDecode(userB64);
}

export const portalCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
