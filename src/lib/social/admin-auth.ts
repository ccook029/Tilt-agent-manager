/**
 * Lightweight gate for the web-based admin/setup actions (migrate, sync) until
 * real auth lands in Phase 5.
 *
 * If ADMIN_TOKEN is set, the matching token must be supplied (header or body).
 * If it is NOT set, actions are allowed but the UI shows an "unprotected"
 * warning so the founder knows to set one.
 */

export function adminTokenConfigured(): boolean {
  return Boolean(process.env.ADMIN_TOKEN);
}

export function checkAdminToken(provided: string | null | undefined): {
  ok: boolean;
  reason?: string;
} {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return { ok: true };
  if (!provided) return { ok: false, reason: "Admin token required." };
  if (provided !== expected) return { ok: false, reason: "Invalid admin token." };
  return { ok: true };
}

/** Pulls the token from an x-admin-token header or a JSON body field. */
export function tokenFromRequest(
  req: Request,
  body?: { token?: string },
): string | null {
  return req.headers.get("x-admin-token") ?? body?.token ?? null;
}
