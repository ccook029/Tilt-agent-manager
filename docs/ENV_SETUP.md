# Tilt OS — Environment Setup Runbook

Everything you need to set, per Vercel project, to make the whole system work:
one login, the Design Studio, Files, the absorbed Social + Inventory modules,
accounting restricted to you, question delegation, and per-person briefs.

Work top to bottom. **Bold = you must set it.** The rest is either already
set (your agents run today) or optional.

Hub production URL used below: `https://tilt-agent-manager-i3tk.vercel.app`
(replace if yours differs).

---

## Step 0 — Generate the shared secrets (once)

Run these locally (or use any random-string generator) and keep the output:

```
openssl rand -hex 32     # → TILT_OS_SESSION_SECRET  (hub AND tiltweb, same value)
openssl rand -hex 24     # → MODULES_SHARED_KEY      (hub AND catalog, same value)
```

`OS_SHARED_PASSCODE` (optional) is just a passphrase you pick — a stopgap so
you can sign in before per-person login is wired.

---

## Step 1 — Hub storage (Tilt-agent-manager project)

In Vercel → your hub project → **Storage**, make sure these three exist. Each
injects its own env vars automatically — you don't type them by hand:

| Add this store | Auto-injects | Powers |
|---|---|---|
| **KV** (Upstash Redis) | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | signals, run logs, questions/policy ledger, staff directory — **required, nothing persists without it** |
| **Blob** | `BLOB_READ_WRITE_TOKEN` | the Files cabinet + social render output |
| **Postgres** (Neon) | `DATABASE_URL` / `POSTGRES_URL` | the Social Studio content plan (reuse the DB the old social app used) |

If your agents already run in production you very likely have KV already —
just confirm. Blob and Postgres are new for the absorbed modules.

---

## Step 2 — Hub env vars (Tilt-agent-manager project)

### 2a. New — the features you just asked for

| Variable | Value | Why |
|---|---|---|
| **`TILT_OS_SESSION_SECRET`** | the hex-32 secret | **Setting this turns the login wall ON** for the whole hub |
| **`TILTWEB_URL`** | `https://www.tilthockey.com` | per-person login (real staff emails) — required for the accounting restriction, assignment, and Jeremy's brief to work |
| **`ACCOUNTING_OWNER_EMAILS`** | `chris@tilthockey.com` | restricts CFO/Penny + the questions console to you |
| **`MORNING_BRIEF_RECIPIENTS`** | `chris@tilthockey.com=accounting, jeremy@tilthockey.com=inventory` | your accounting-focused brief + Jeremy's inventory/purchasing brief |
| **`MODULES_SHARED_KEY`** | the hex-24 secret | lets the catalog agent push signals into your brief |
| `OS_SHARED_PASSCODE` | any passphrase | optional; a shared login to use before per-person login is live |
| `ACCOUNTING_OWNER_STAFF_IDS` | (blank) | optional fallback if an email-match ever misses |

### 2b. New — carry over from the OLD Social Studio project (now `/studio/social` + the Design Studio builders)

The **full** social app is now absorbed: the content planner (`/studio/social`)
**and** the three staff builders — Blanket Fundraiser (`/studio/blanket`),
SOX Creator (`/studio/sox`), and Announcements (`/studio/announcements`). They
all share the same keys below (Claude for copy, Gemini for the flyer renders,
Blob to store the image, Postgres to save the draft).

Copy these from the tilt-social-media-manager Vercel project:

| Variable | Value / source |
|---|---|
| **`GEMINI_API_KEY`** | your Google Gemini key (social image renders) |
| **`ZOHO_WORKDRIVE_CLIENT_ID`** | WorkDrive Zoho app client id |
| **`ZOHO_WORKDRIVE_CLIENT_SECRET`** | WorkDrive Zoho app secret |
| **`ZOHO_WORKDRIVE_REFRESH_TOKEN`** | WorkDrive refresh token |
| **`ZOHO_WORKDRIVE_ROOT_FOLDER_ID`** | the "TILT HOCKEY SHOOT" folder id |
| `ZOHO_ACCOUNTS_DOMAIN` | optional, default `https://accounts.zoho.com` |
| `ZOHO_WORKDRIVE_API_BASE` | optional, default `https://www.zohoapis.com/workdrive/api/v1` |
| `ANTHROPIC_BRAIN_MODEL` / `ANTHROPIC_VISION_MODEL` | optional; default to your main model |
| `SOCIAL_PLAN_CRON` | optional; set to `true` to auto-regenerate the plan on Sundays |
| `ADMIN_TOKEN` | optional; a second factor on the studio's setup buttons |
| `SHOTSTACK_API_KEY` / `SHOTSTACK_ENV` | optional; only if you want auto-generated **video reels** in the plan. Leave unset and reels fall back to branded stills |

> **Blob without a token:** if you added the Blob store from the Vercel
> dashboard, it connects via OIDC (`BLOB_STORE_ID` + a runtime token) and no
> `BLOB_READ_WRITE_TOKEN` is needed — the code accepts either.

> WorkDrive is a **separate Zoho app** from your Books/Inventory one. If you
> only have one Zoho app, you can leave the `ZOHO_WORKDRIVE_*` vars unset and
> it falls back to your main `ZOHO_*` — but that app's token then needs a
> WorkDrive scope (see Step 5).

### 2c. New — carry over from the OLD tiltinventory project (now `/inventory`)

| Variable | Value / source |
|---|---|
| **`ZOHO_WORKBOOK_ID`** | the stick-inventory Zoho Sheet workbook id |
| `ZOHO_PLAYER_STICK_SHEET` | optional, default `Player Sticks` |
| `ZOHO_SOLD_STICK_SHEET` | optional, default `Sold Stick` |

Inventory reuses your main `ZOHO_*` OAuth — but **selling writes to the sheet**,
so that token needs a ZohoSheet **write** scope (Step 5).

### 2d. Already set — leave as they are

These make your existing agents run; you should already have them:

`ANTHROPIC_API_KEY`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`,
`ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID`, `ZOHO_SHEET_RESOURCE_ID`,
`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TO`, `REPORT_EMAIL_TO`,
`GA4_PROPERTY_ID`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`,
`INBOX_USER`, `INBOX_APP_PASSWORD`, `SERPER_API_KEY`, `APIFY_API_KEY`,
`NEXT_PUBLIC_CATALOG_URL`, `CATALOG_ACCESS_KEY`, `CRON_SECRET`.

Optional / advanced (only if you use them): `CLAUDE_MODEL`,
`ZOHO_ACCOUNTS_URL`, `ZOHO_BOOKS_MCP_URL`, `ZOHO_BOOKS_MCP_TOKEN`,
`IMAP_HOST`, `IMAP_PORT`, `GEMINI_API_BASE`, `GEMINI_IMAGE_MODEL`.

Do **not** set `NODE_ENV` or the `VERCEL_GIT_*` vars — Vercel manages those.

---

## Step 3 — tiltweb project (the website — only its staff login joins the OS)

| Variable | Value |
|---|---|
| **`TILT_OS_SESSION_SECRET`** | the **same hex-32 value** as the hub |
| **`OS_APP_CALLBACKS`** | `https://tilt-agent-manager-i3tk.vercel.app` |

Already set (leave): `PORTAL_SESSION_SECRET`, `ADMIN_PASSWORD`,
`DATABASE_URL`/`POSTGRES_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.

Your staff accounts (you, Jeremy) live in tiltweb's `admin_users` table — the
same ones you use for the website's `/admin`. That's what per-person hub login
checks against.

---

## Step 4 — tilt-catalog-agent project (stays its own small app)

| Variable | Value |
|---|---|
| **`TILT_HQ_URL`** | `https://tilt-agent-manager-i3tk.vercel.app` |
| **`MODULES_SHARED_KEY`** | the **same hex-24 value** as the hub |

Already set (leave): `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, `CATALOG_ACCESS_KEY`.

---

## Step 5 — Zoho scopes (important, easy to miss)

Zoho refresh tokens are scoped **when created** — you can't add a scope to an
existing token, you regenerate it. Make sure your tokens cover:

- **Main hub token** (`ZOHO_REFRESH_TOKEN`): Inventory + Books + Sheet, and now
  **Sheet write** for stick selling, e.g.
  `ZohoInventory.fullaccess.all, ZohoBooks.fullaccess.all, ZohoSheet.dataAPI.READ, ZohoSheet.dataAPI.UPDATE`.
- **WorkDrive token** (`ZOHO_WORKDRIVE_REFRESH_TOKEN`): a WorkDrive scope,
  created from the WorkDrive Zoho app.

If selling a stick fails with a permissions error, the Sheet write scope is
the cause — regenerate the main token with the scope string above.

---

## Step 6 — Redeploy

Redeploy all three projects (hub, tiltweb, catalog) after saving env vars so
they pick them up.

---

## Step 7 — First sign-in + onboard Jeremy

1. Open the hub URL. You'll hit the new **/login** screen.
2. Sign in with your tiltweb staff email + password (or leave email blank and
   use `OS_SHARED_PASSCODE` if you set one).
3. Have **Jeremy sign in once** with his own tiltweb email + password. This
   records him in the staff directory so you can assign him questions and his
   inventory brief matches his email.

---

## Step 8 — Verify it works

- **Login wall:** open the hub in a private window → it redirects to /login. ✅
- **Accounting is yours only:** signed in as you, the CFO (Sterling) and Penny
  agents + the Questions console are visible. Signed in as Jeremy, the CFO/Penny
  cards are gone and those pages say "Restricted." ✅
- **Assignment:** on Questions, delegate a test question to Jeremy's email →
  Jeremy sees only that one on his Questions page and can answer it. ✅
- **Briefs:** trigger the brief (the daily cron, or hit the brief manually) →
  you get an accounting-focused email, Jeremy gets an inventory/purchasing one
  with only his assigned questions. ✅

---

## Step 9 — Decommission the old apps (optional, saves build cost)

Once `/studio/social` and `/inventory` work inside the hub with the copied env
vars, pause then delete the old **tilt-social-media-manager** and
**tiltinventory** Vercel projects. Two fewer build pipelines. (tiltweb and the
catalog agent stay as their own projects.)

---

## Minimal path — just the two things you asked for

If you only want accounting-restricted + per-person briefs and nothing else
yet:

1. Hub: `TILT_OS_SESSION_SECRET`, `TILTWEB_URL`, `ACCOUNTING_OWNER_EMAILS`,
   `MORNING_BRIEF_RECIPIENTS` (+ confirm KV store exists).
2. tiltweb: `TILT_OS_SESSION_SECRET` (same value), `OS_APP_CALLBACKS`.
3. Redeploy both; you and Jeremy each sign in once.

The Social/Inventory module vars (Steps 2b/2c) can wait until you're ready to
turn those modules on.
