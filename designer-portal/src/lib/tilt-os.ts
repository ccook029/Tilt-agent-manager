// ---------------------------------------------------------------------------
// tilt-os.ts — sign in with existing Tilt OS staff credentials.
//
// Mirrors the agent manager's /api/os/login: proxy {email, password} to
// tiltweb's POST /api/os/login (TILTWEB_URL), which verifies against the real
// admin_users directory and returns an OS token (`os.<staffId>.<expiry>.<hmac>`)
// signed with the shared TILT_OS_SESSION_SECRET. When that secret is set here
// too, we re-verify the returned token before trusting the login; the portal
// then mints its own session cookie (see auth.ts) — the OS token is never
// stored.
// ---------------------------------------------------------------------------

export function tiltOsEnabled(): boolean {
  return Boolean(process.env.TILTWEB_URL);
}

async function osHmacHex(payload: string): Promise<string | null> {
  const secret = process.env.TILT_OS_SESSION_SECRET;
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks a tiltweb-issued OS token. Returns true when valid, false when
 * forged/expired, and true-with-a-pass when TILT_OS_SESSION_SECRET isn't
 * configured here (tiltweb's 200 is then the only check — set the secret to
 * get the stronger guarantee, same as the agent manager).
 */
async function osTokenAcceptable(token: string | undefined): Promise<boolean> {
  if (!process.env.TILT_OS_SESSION_SECRET) return true;
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "os") return false;
  const [, idStr, expiryStr, signature] = parts;
  const expected = await osHmacHex(`os.${idStr}.${expiryStr}`);
  if (!expected || !safeEqual(signature, expected)) return false;
  return Number(expiryStr) >= Math.floor(Date.now() / 1000);
}

export type TiltOsResult =
  | { ok: true; email: string }
  | { ok: false; status: number; error: string };

export async function tiltOsLogin(email: string, password: string): Promise<TiltOsResult> {
  const base = process.env.TILTWEB_URL?.replace(/\/$/, "");
  if (!base) return { ok: false, status: 503, error: "Tilt staff login is not configured." };

  let res: Response;
  try {
    res = await fetch(`${base}/api/os/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 502, error: "Could not reach the Tilt staff directory. Try again." };
  }
  if (!res.ok) return { ok: false, status: 401, error: "Wrong email or password." };

  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    staff?: { email?: string };
  };
  if (!(await osTokenAcceptable(data.token))) {
    return { ok: false, status: 502, error: "Staff directory returned an invalid session token." };
  }
  return { ok: true, email: (data.staff?.email || email).trim().toLowerCase() };
}
