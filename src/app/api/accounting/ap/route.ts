// ---------------------------------------------------------------------------
// /api/accounting/ap — Penny's AP Inbox (propose → approve → create).
//
// GET                         → list proposals
// POST { mode: "scan", limit } → read N unprocessed inbox docs, propose entries
// POST { mode: "approve", id } → create the Bill/Expense in Zoho
// POST { mode: "reject",  id } → dismiss a proposal
// Auth: accounting owner (or cron).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  listProposals,
  buildApProposals,
  approveProposal,
  rejectProposal,
  refineProposal,
} from "@/lib/accounting-ap";
import { fetchChartOfAccounts } from "@/lib/zoho-books";
import { guardAccountingOwner } from "@/lib/os-identity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;
  const [proposals, accounts] = await Promise.all([
    listProposals(),
    fetchChartOfAccounts()
      .then((a) =>
        a
          .filter((x) => x.is_active !== false)
          .map((x) => ({ name: x.account_name, type: x.account_type }))
      )
      .catch(() => [] as { name: string; type: string }[]),
  ]);
  return NextResponse.json({ ok: true, proposals, accounts });
}

export async function POST(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    mode?: string;
    id?: string;
    limit?: number;
    force?: boolean;
    edits?: Record<string, unknown>;
    comment?: string;
  };
  const mode = body.mode ?? "scan";

  try {
    if (mode === "scan") {
      const result = await buildApProposals({ limit: Math.min(body.limit ?? 5, 15) });
      return NextResponse.json({ ok: true, ...result, proposals: await listProposals() });
    }
    if (mode === "approve") {
      if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      const p = await approveProposal(body.id, body.force === true, body.edits);
      return NextResponse.json({
        ok: p.status === "created",
        blockedAsDuplicate: p.status === "proposed" && !!p.duplicateOf,
        proposal: p,
        proposals: await listProposals(),
      });
    }
    if (mode === "reject") {
      if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      await rejectProposal(body.id);
      return NextResponse.json({ ok: true, proposals: await listProposals() });
    }
    if (mode === "refine") {
      if (!body.id || !body.comment?.trim()) {
        return NextResponse.json({ error: "id and comment are required" }, { status: 400 });
      }
      const p = await refineProposal(body.id, body.comment);
      return NextResponse.json({ ok: true, proposal: p, proposals: await listProposals() });
    }
    return NextResponse.json({ error: `Unknown mode "${mode}"` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
