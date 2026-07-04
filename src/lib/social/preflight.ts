import Anthropic from "@anthropic-ai/sdk";
import { list as blobList } from "@vercel/blob";
import { getSql } from "@/lib/social/db";
import { resolveDatabaseUrl, hasBlob } from "@/lib/social/env";
import { probeWorkdrive } from "@/lib/social/workdrive";
import { probeShotstack } from "@/lib/social/render/shotstack";

/**
 * Active go-live preflight. Unlike /api/admin/status (which only checks whether
 * secrets are *present*), each check here actually *exercises* the integration
 * with a cheap real call, so the founder learns which links work and gets an
 * actionable error for the ones that don't — turning the audit's "silent
 * failure" modes into clear diagnostics.
 */

export type CheckResult = {
  /** Stable key + human label. */
  key: string;
  label: string;
  ok: boolean;
  /** Not configured / nothing to test — neither pass nor fail. */
  skipped?: boolean;
  detail: string;
};

const short = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 240);

async function checkDatabase(): Promise<CheckResult[]> {
  if (!resolveDatabaseUrl()) {
    return [
      { key: "db", label: "Database — connect", ok: false, skipped: true, detail: "No connection string set." },
    ];
  }
  const out: CheckResult[] = [];
  try {
    const sql = getSql();
    await sql`select 1`;
    out.push({ key: "db", label: "Database — connect", ok: true, detail: "Connected (SELECT 1 ok)." });

    // Are the tables there? (i.e. has Initialize database been run?)
    const rows = await sql<{ reg: string | null }[]>`select to_regclass('public.assets')::text as reg`;
    const migrated = Boolean(rows[0]?.reg);
    out.push({
      key: "db-migrated",
      label: "Database — schema",
      ok: migrated,
      detail: migrated
        ? "Core tables present (migrations applied)."
        : "Connected, but tables are missing — click Initialize database.",
    });
  } catch (e) {
    out.push({ key: "db", label: "Database — connect", ok: false, detail: short(e) });
  }
  return out;
}

async function checkAnthropic(): Promise<CheckResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { key: "anthropic", label: "Claude API key", ok: false, skipped: true, detail: "ANTHROPIC_API_KEY not set." };
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const models = await client.models.list({ limit: 1 });
    const sample = models.data?.[0]?.id;
    return { key: "anthropic", label: "Claude API key", ok: true, detail: `Authenticated${sample ? ` (e.g. ${sample})` : ""}.` };
  } catch (e) {
    return { key: "anthropic", label: "Claude API key", ok: false, detail: short(e) };
  }
}

async function checkBlob(): Promise<CheckResult> {
  if (!hasBlob()) {
    return { key: "blob", label: "Vercel Blob", ok: false, skipped: true, detail: "Not connected (no read-write token or OIDC BLOB_STORE_ID)." };
  }
  // The SDK auto-resolves either auth mode; report which one is in play.
  const mode = process.env.BLOB_READ_WRITE_TOKEN ? "read-write token" : "OIDC";
  try {
    const res = await blobList({ limit: 1 });
    return { key: "blob", label: "Vercel Blob", ok: true, detail: `Connected via ${mode} (${res.blobs.length} blob(s) sampled).` };
  } catch (e) {
    return { key: "blob", label: "Vercel Blob", ok: false, detail: `${short(e)} [auth: ${mode}]` };
  }
}

async function checkWorkdrive(): Promise<CheckResult[]> {
  const configured =
    process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET;
  if (!configured) {
    return [
      { key: "wd-auth", label: "WorkDrive — auth", ok: false, skipped: true, detail: "Zoho credentials not set." },
    ];
  }
  try {
    const p = await probeWorkdrive();
    return [
      { key: "wd-auth", label: "WorkDrive — auth", ok: p.auth.ok, detail: p.auth.detail },
      { key: "wd-folder", label: "WorkDrive — folder", ok: p.folder.ok, detail: p.folder.detail },
      { key: "wd-download", label: "WorkDrive — download", ok: p.download.ok, skipped: p.download.skipped, detail: p.download.detail },
    ];
  } catch (e) {
    return [{ key: "wd-auth", label: "WorkDrive — auth", ok: false, detail: short(e) }];
  }
}

async function checkGemini(): Promise<CheckResult> {
  if (!process.env.GEMINI_API_KEY) {
    return { key: "gemini", label: "Gemini (renders)", ok: true, skipped: true, detail: "GEMINI_API_KEY not set — static renders disabled (optional)." };
  }
  const base = process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";
  const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3-pro-image-preview";
  try {
    // Validate the key AND that the configured image model id actually exists.
    const res = await fetch(`${base}/models/${model}?key=${process.env.GEMINI_API_KEY}`);
    if (res.ok) {
      return { key: "gemini", label: "Gemini (renders)", ok: true, detail: `Key valid and model "${model}" available.` };
    }
    if (res.status === 404) {
      return { key: "gemini", label: "Gemini (renders)", ok: false, detail: `Model "${model}" not found — set GEMINI_IMAGE_MODEL to a current image model id.` };
    }
    return { key: "gemini", label: "Gemini (renders)", ok: false, detail: `Gemini check failed: ${res.status} ${(await res.text()).slice(0, 120)}` };
  } catch (e) {
    return { key: "gemini", label: "Gemini (renders)", ok: false, detail: short(e) };
  }
}

async function checkShotstack(): Promise<CheckResult> {
  if (!process.env.SHOTSTACK_API_KEY) {
    return { key: "shotstack", label: "Shotstack (reels)", ok: true, skipped: true, detail: "SHOTSTACK_API_KEY not set — auto-reels disabled (optional)." };
  }
  try {
    const p = await probeShotstack();
    return { key: "shotstack", label: "Shotstack (reels)", ok: p.ok, detail: p.detail };
  } catch (e) {
    return { key: "shotstack", label: "Shotstack (reels)", ok: false, detail: short(e) };
  }
}

export async function runPreflight(): Promise<{ checks: CheckResult[]; ready: boolean }> {
  // Run independent checks concurrently; each is internally fail-safe.
  const [db, anthropic, blob, workdrive, gemini, shotstack] = await Promise.all([
    checkDatabase(),
    checkAnthropic(),
    checkBlob(),
    checkWorkdrive(),
    checkGemini(),
    checkShotstack(),
  ]);
  const checks = [...db, anthropic, blob, ...workdrive, gemini, shotstack];
  // "Ready to operate" = every non-skipped check passed.
  const ready = checks.every((c) => c.ok || c.skipped);
  return { checks, ready };
}
