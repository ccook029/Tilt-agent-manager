// ---------------------------------------------------------------------------
// /api/strategy/contracts — the expected-contracts pipeline. Owner-only.
//   GET    → { contracts, projection }
//   POST   → add a contract (body = ContractInput)
//   PATCH  → { id, ...patch } update
//   DELETE → ?id=... remove
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { guardAccountingOwner } from "@/lib/os-identity";
import {
  getContracts,
  addContract,
  updateContract,
  deleteContract,
  type Cadence,
  type ContractStatus,
} from "@/lib/expected-contracts";
import { buildProjection } from "@/lib/projections";

export const dynamic = "force-dynamic";

const CADENCES: Cadence[] = ["one-time", "monthly", "annual"];
const STATUSES: ContractStatus[] = ["pipeline", "won", "lost"];

function sanitize(body: Record<string, unknown>) {
  const amount = Number(body.amount);
  const probability = Number(body.probability);
  return {
    name: String(body.name ?? "").trim(),
    counterparty: body.counterparty ? String(body.counterparty).trim() : undefined,
    amount: Number.isFinite(amount) ? amount : 0,
    cadence: CADENCES.includes(body.cadence as Cadence) ? (body.cadence as Cadence) : "one-time",
    probability: Number.isFinite(probability) ? Math.max(0, Math.min(100, probability)) : 50,
    expectedStart: String(body.expectedStart ?? "").slice(0, 10),
    termMonths: body.termMonths != null ? Number(body.termMonths) : undefined,
    status: STATUSES.includes(body.status as ContractStatus) ? (body.status as ContractStatus) : "pipeline",
    category: body.category ? String(body.category).trim() : undefined,
    notes: body.notes ? String(body.notes).trim() : undefined,
  };
}

export async function GET(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;
  const contracts = await getContracts();
  const months = Number(request.nextUrl.searchParams.get("months")) || 12;
  return NextResponse.json({
    ok: true,
    contracts,
    projection: buildProjection(contracts, months),
  });
}

export async function POST(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const input = sanitize(body);
  if (!input.name || !input.expectedStart) {
    return NextResponse.json(
      { error: "name and expectedStart are required" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, contract: await addContract(input) });
}

export async function PATCH(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const updated = await updateContract(id, sanitize(body));
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, contract: updated });
}

export async function DELETE(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = await deleteContract(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
