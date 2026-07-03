// ---------------------------------------------------------------------------
// os-identity.ts — who is the signed-in staff member, and what may they see.
//
// The OS session cookie only carries a numeric staffId (see os-auth.ts). To
// turn that into a person (name/email) and to make per-person access
// decisions, we keep a small staff directory in KV, populated the first time
// each person signs in with their email. Two roles matter today:
//
//   - Accounting owner  → full access to the CFO/Penny agents, the accounting
//                         routes, and the decisions console. Configured with
//                         ACCOUNTING_OWNER_EMAILS (and/or _STAFF_IDS).
//   - Everyone else      → no accounting access, EXCEPT questions explicitly
//                         assigned to them (see policy-ledger assignment).
//
// Dormant by default: with no owner configured (or the login wall off), the
// accounting surface stays open exactly as before — the owner opts in by
// setting ACCOUNTING_OWNER_EMAILS. The shared-passcode session (id 0) is
// always treated as the owner, since that passcode is a Chris-only bootstrap.
// ---------------------------------------------------------------------------
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { OS_COOKIE, SHARED_STAFF_ID, osAuthEnabled, verifyOsToken } from "./os-auth";

const DIRECTORY_KEY = "os-staff-directory";

export interface StaffProfile {
  id: number;
  name: string;
  email: string;
}

// ---- Directory ------------------------------------------------------------

/** Record (upsert) a staff member the first time we learn their email. */
export async function recordStaff(profile: StaffProfile): Promise<void> {
  if (!profile.email) return; // nothing to remember without an email
  try {
    const dir = (await kv.get<Record<string, StaffProfile>>(DIRECTORY_KEY)) ?? {};
    dir[String(profile.id)] = {
      id: profile.id,
      name: profile.name || dir[String(profile.id)]?.name || profile.email,
      email: profile.email.toLowerCase(),
    };
    await kv.set(DIRECTORY_KEY, dir);
  } catch {
    // A directory hiccup must never block sign-in.
  }
}

/** Everyone who has signed in with an email (for the assignment picker). */
export async function getStaffDirectory(): Promise<StaffProfile[]> {
  try {
    const dir = (await kv.get<Record<string, StaffProfile>>(DIRECTORY_KEY)) ?? {};
    return Object.values(dir).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ---- Current session ------------------------------------------------------

/**
 * The signed-in staff member for this request, or null when the login wall is
 * off or nobody is signed in. Reads the OS cookie, then resolves the id to a
 * profile via the directory (id 0 → the synthetic shared-passcode identity).
 */
export async function getCurrentStaff(): Promise<StaffProfile | null> {
  if (!osAuthEnabled()) return null;
  const token = (await cookies()).get(OS_COOKIE)?.value;
  const id = await verifyOsToken(token);
  if (id === null) return null;
  if (id === SHARED_STAFF_ID) {
    return { id: SHARED_STAFF_ID, name: "Tilt Staff", email: "" };
  }
  try {
    const dir = (await kv.get<Record<string, StaffProfile>>(DIRECTORY_KEY)) ?? {};
    const profile = dir[String(id)];
    if (profile) return profile;
  } catch {
    // fall through to the id-only profile
  }
  // Known id but no recorded email yet (e.g. arrived via SSO before an email
  // login). We know who they are by id, just not their email.
  return { id, name: `Staff #${id}`, email: "" };
}

// ---- Accounting-owner role ------------------------------------------------

function parseList(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function ownerEmails(): string[] {
  return parseList(process.env.ACCOUNTING_OWNER_EMAILS).map((e) => e.toLowerCase());
}

function ownerIds(): number[] {
  return parseList(process.env.ACCOUNTING_OWNER_STAFF_IDS)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n));
}

/** Is the accounting surface restricted at all on this deploy? */
export function accountingRestricted(): boolean {
  return osAuthEnabled() && (ownerEmails().length > 0 || ownerIds().length > 0);
}

/** May this staff member use the CFO/Penny agents and accounting console? */
export function isAccountingOwner(staff: StaffProfile | null): boolean {
  if (!osAuthEnabled()) return true; // login wall off → unrestricted (dev / pre-launch)
  if (!staff) return false; // signed out (shouldn't reach here past middleware)
  if (staff.id === SHARED_STAFF_ID) return true; // shared passcode = Chris-only bootstrap
  if (!accountingRestricted()) return true; // no owner configured → open as before
  if (ownerIds().includes(staff.id)) return true;
  if (staff.email && ownerEmails().includes(staff.email.toLowerCase())) return true;
  return false;
}

/**
 * Route-handler guard: returns a 403 NextResponse when the caller is not the
 * accounting owner, or null when they may proceed. The cron (CRON_SECRET
 * bearer) is always allowed so scheduled accounting jobs keep working.
 */
export async function guardAccountingOwner(
  request: NextRequest
): Promise<NextResponse | null> {
  const auth = request.headers.get("authorization");
  if (
    auth &&
    process.env.CRON_SECRET &&
    auth === `Bearer ${process.env.CRON_SECRET}`
  ) {
    return null;
  }
  const staff = await getCurrentStaff();
  if (isAccountingOwner(staff)) return null;
  return NextResponse.json(
    { error: "Restricted to the accounting owner." },
    { status: 403 }
  );
}
