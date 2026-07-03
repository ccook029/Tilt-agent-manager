// ---------------------------------------------------------------------------
// GET /api/os/me — who am I, and what may I do?
//
// Any signed-in staff member can call this. The UI uses it to decide what to
// show (e.g. hide the accounting agents from non-owners, route them to their
// assigned questions instead of the full console).
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { osAuthEnabled } from "@/lib/os-auth";
import { getCurrentStaff, isAccountingOwner } from "@/lib/os-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await getCurrentStaff();
  return NextResponse.json(
    {
      ok: true,
      authEnabled: osAuthEnabled(),
      staff,
      isAccountingOwner: isAccountingOwner(staff),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
