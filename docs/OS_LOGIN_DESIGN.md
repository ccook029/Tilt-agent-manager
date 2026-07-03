# Tilt OS Login — tiltweb Staff-Auth Audit & OS-Wide Design

**Date:** 2026-07-03 · **Status:** Design (approved scope: staff login only)
**Scope decision:** Only the **Staff login** section of the Tilt website joins
the OS. The partner portal, retailer onboarding, secret club, and giveaway
auth all stay in tiltweb, untouched. tiltweb's public site is unaffected.

This closes audit item **P0 #1** (no auth anywhere) with a single staff
identity across every Tilt tool, instead of one passcode per app.

---

## Part 1 — Audit of tiltweb's auth

tiltweb has **no global middleware**; auth is enforced per-route by helper
functions. Four separate mechanisms exist (plus HTTP Basic in the giveaway
sub-app). They are cleanly separated by cookie name, token prefix, and table:

| System | Cookie | TTL | Backing | Joins the OS? |
|---|---|---|---|---|
| **Staff / Admin** (`/admin`) | `tilt_admin_session` | 12 h | `admin_users` (Neon) | ✅ **Yes — this is the OS login** |
| Partner portal / team | `tilt_portal_session` | 14 d | `partners` | ❌ stays in tiltweb |
| Retailer onboarding | `tilt_onboarding_session` | 6 h | `onboarding_invites` | ❌ stays |
| Secret club | none (stateless codes) | — | `accessCodes` | ❌ stays |
| Giveaway sub-app | HTTP Basic | — | env | ❌ stays |

### How the staff login works today

- **Files:** `src/lib/admin-auth.ts` (core), `src/app/api/admin/login/route.ts`,
  `src/app/api/admin/logout/route.ts`, `src/app/admin/login/page.tsx`;
  `hashPassword`/`verifyPassword` live in `src/lib/portal-auth.ts`; the
  `admin_users` queries sit in `src/lib/db.ts:1215-1259`.
- **Credentials:** per-person rows in `admin_users` (id, name, email, scrypt
  `salt:hash` password, role, active). Passwords verified with Node `scrypt`
  + `timingSafeEqual`. A **shared plaintext `ADMIN_PASSWORD`** env var also
  grants a "bootstrap" login as synthetic admin id `0`.
- **Session token:** not a JWT — a compact HMAC token
  `admin.<adminId>.<expiryEpoch>.<hmacSha256Hex>` signed with
  `PORTAL_SESSION_SECRET`, set as an `httpOnly`, `sameSite=lax`,
  `secure`(prod) cookie, 12-hour TTL, fully stateless (no server session
  store).
- **Verification:** `verifyAdminToken()` re-computes the HMAC
  (timing-safe), checks expiry, returns the admin id. Pages call
  `isAdmin()` → redirect to `/admin/login`; APIs return 401.
- **Rate limiting:** in-memory IP limiter, 10 attempts / 5 min on login.

### Weaknesses to fix on the way into the OS

1. **Shared signing secret** — `PORTAL_SESSION_SECRET` signs staff, partner,
   *and* onboarding cookies; only the token prefix separates privilege
   levels. The OS must get its **own dedicated secret**.
2. **Plaintext bootstrap password** — `ADMIN_PASSWORD` is an unattributed,
   never-expiring backdoor. It must **not** be honored for OS access.
3. **No revocation** — a stolen token is valid for the full 12 h; logout
   only clears one browser's cookie. Acceptable for v1; noted below.
4. **In-memory rate limiter** — resets per serverless instance; fine only
   because credential checks stay centralized in tiltweb (one enforcement
   point), and can later move to KV.
5. **Dev fallback secret** — a hardcoded string signs tokens whenever
   `NODE_ENV !== "production"`. OS verifiers must hard-fail without a real
   secret instead.

The core is otherwise **ideal for extraction**: Node stdlib crypto only, no
auth framework, ~80 lines of pure functions. That's why the OS login is
designed *around* it rather than around Auth.js/Clerk.

---

## Part 2 — OS-wide login design

### Constraints

- The five apps live on **separate `*.vercel.app` domains**. `vercel.app` is
  on the Public Suffix List, so **cookies cannot be shared** across apps.
  A single sign-on therefore works by **token handoff**, not a shared cookie.
- tiltweb's Neon `admin_users` table is the **only real staff directory**
  (Chris, Jeremy, salespeople; per-person attribution). Duplicating
  credential storage into each app would recreate the problem the OS exists
  to solve.
- The satellites deliberately integrate via copy-paste-sized modules and
  plain HTTP (see the signals inbox) — no shared npm package.

### Shape: tiltweb is the identity provider; every app verifies the same token

```
                 credentials (email+password)
   [any OS app /login] ────────────────────────► tiltweb POST /api/os/login
        ▲                                             │ verify vs admin_users
        │  set tilt_os_session cookie                 │ (scrypt + rate limit)
        └──────────────── OS token ◄──────────────────┘
                    os.<staffId>.<expiry>.<hmac>
                 signed with TILT_OS_SESSION_SECRET

   already signed in to tiltweb /admin?
   [hub dashboard] ─► tiltweb GET /admin/os-authorize?app=hub
                        │ staff cookie valid → mint 60s OS token
                        └─► redirect to app /api/os/callback?token=…
                              → app verifies, sets its own cookie
```

**1. The OS token** — the tiltweb staff token, generalized:

- Format `os.<staffId>.<expiryEpoch>.<hmacSha256Hex>` — same scheme as
  `admin.<id>.<expiry>.<sig>`, new prefix so the two can never be confused.
- Signed with a **new, dedicated `TILT_OS_SESSION_SECRET`** (≥32 chars),
  set identically in all five Vercel projects. `PORTAL_SESSION_SECRET`
  is never shared outside tiltweb (fixes weakness #1).
- 12-hour session TTL (matches staff habit today); **60-second TTL** when
  minted for a redirect handoff.
- Bootstrap admin id `0` is **rejected** by every OS verifier — only real
  `admin_users` rows get OS access (fixes weakness #2).

**2. tiltweb additions (the only tiltweb changes — inside the staff section):**

- `POST /api/os/login` — body `{email, password}`; reuses the existing
  `getAdminAuthByEmail` + `verifyPassword` + rate limiter; returns
  `{token, staff: {id, name, email}}`. No shared-password path.
- `GET /admin/os-authorize?app=<hub|social|inventory|catalog>&cb=<url>` —
  if the `tilt_admin_session` cookie is valid, mint a 60s OS token and
  302 to the app's callback; else show the normal staff login first.
  Callback URLs are validated against an allowlist env
  (`OS_APP_CALLBACKS`), never taken free-form.
- Optionally, `admin-auth.ts` also *accepts* a valid OS token as an
  alternative to its own cookie, so staff who signed in from the hub can
  open `/admin` without a second login. Everything else in tiltweb keeps
  using `tilt_admin_session` exactly as today.

**3. Per-app verifier + gate (copy-paste module, like the signals client):**

- **Next.js apps** (hub, Social Studio, tiltinventory): one ~70-line
  `src/lib/os-auth.ts` — `verifyOsToken()`, `currentStaffId()`, cookie
  constants (`tilt_os_session`, httpOnly, `secure: true` always, lax,
  12 h) — plus a `middleware.ts` that gates **everything except**:
  `/login`, `/api/os/callback`, `/api/cron/*` (Bearer `CRON_SECRET`),
  and `/api/signals` (Bearer `MODULES_SHARED_KEY`). This finally closes
  the hub's open write-capable APIs (audit P0 #1) with one file.
- **Catalog agent** (Python): a ~40-line `verify_os_token()` in
  `tilt_catalog/`, checked in `access_denied()` alongside the existing
  `CATALOG_ACCESS_KEY` header during transition. The launch flow stays
  identical — the token rides the same `?key=` → `sessionStorage` →
  header path the app already implements, just carrying a signed,
  expiring token instead of a static secret.
- Each Next app gets a minimal `/login` page that server-side proxies
  credentials to tiltweb `/api/os/login` (no CORS, password never touches
  satellite code paths beyond the proxy) and sets the local cookie.

**4. Hub launch router upgrade** — `/api/modules/launch` currently appends a
static `?key=<ACCESS_KEY>`. Once OS auth lands it instead forwards the
*current user's* short-lived OS token (or simply relies on the satellite's
own cookie/os-authorize redirect). Static `*_ACCESS_KEY`s are then retired
for human access. **`MODULES_SHARED_KEY` stays** — it authenticates
server-to-server signal pushes, a different job than human login.

### What deliberately does NOT change

- Partner portal, team login, retailer onboarding, secret club, giveaway —
  all keep their existing cookies, secrets, tables, and TTLs in tiltweb.
- `CRON_SECRET` continues to guard cron routes; signals keep
  `MODULES_SHARED_KEY`.
- No new auth framework, no OAuth server, no shared package registry.

### Env matrix

| Var | tiltweb | hub | social | inventory | catalog |
|---|---|---|---|---|---|
| `TILT_OS_SESSION_SECRET` (new) | mint + verify | verify | verify | verify | verify |
| `OS_APP_CALLBACKS` (new) | ✓ | — | — | — | — |
| `PORTAL_SESSION_SECRET` | unchanged, private | — | — | — | — |
| `ADMIN_PASSWORD` | tiltweb-local only | — | — | — | — |
| `MODULES_SHARED_KEY` | (optional, to push signals) | inbox | push | push | push |

### Rollout order (each step useful on its own)

1. **tiltweb:** add `/api/os/login` + `/admin/os-authorize` (small PR,
   staff section only).
2. **Hub:** `os-auth.ts` + `middleware.ts` + `/login` — the biggest single
   win: the dashboard, Zoho-writing APIs, and question queue stop being
   public. (Until then, Vercel Deployment Protection remains the stopgap
   per the platform audit.)
3. **Social Studio + Inventory:** same two files each; Social Studio's
   `ADMIN_TOKEN` gate becomes redundant and is removed.
4. **Catalog agent:** accept OS tokens in `access_denied()`; retire the
   static `CATALOG_ACCESS_KEY` once the hub launches with tokens.
5. **Later hardening:** KV-backed token denylist for true logout/revocation,
   KV rate limiting, password policy, admin login audit log.

### Non-goals / future

- Roles/RBAC: `admin_users.role` exists but is unenforced; the OS treats
  all staff as equal until a real need appears.
- MFA and passkeys: worth doing once the OS login is the single front door,
  not before.
