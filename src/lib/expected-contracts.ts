// ---------------------------------------------------------------------------
// expected-contracts.ts — Chris's revenue pipeline for projections.
//
// Deals Tilt expects but hasn't fully booked: team orders, sponsorships,
// wholesale accounts, retainers. Each carries a probability and a cadence, so
// Sterling can project probability-weighted revenue forward and reason about
// growth scenarios. Stored in KV (see the Strategy → Contracts screen).
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "expected-contracts";
const MAX = 500;

export type Cadence = "one-time" | "monthly" | "annual";
export type ContractStatus = "pipeline" | "won" | "lost";

export interface ExpectedContract {
  id: string;
  name: string;
  counterparty?: string;
  /** Total value for one-time; per-period value for monthly/annual. */
  amount: number;
  cadence: Cadence;
  /** 0–100. Ignored (treated as 100/0) when status is won/lost. */
  probability: number;
  /** ISO date (YYYY-MM-DD) the revenue starts / the deal closes. */
  expectedStart: string;
  /** For recurring deals: how many months it runs (default 12). */
  termMonths?: number;
  status: ContractStatus;
  category?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ContractInput = Omit<ExpectedContract, "id" | "createdAt" | "updatedAt">;

export async function getContracts(): Promise<ExpectedContract[]> {
  return (await kv.get<ExpectedContract[]>(KEY)) ?? [];
}

export async function addContract(input: ContractInput): Promise<ExpectedContract> {
  const list = await getContracts();
  const now = new Date().toISOString();
  const contract: ExpectedContract = {
    ...input,
    id: `deal-${Date.now()}-${list.length + 1}`,
    createdAt: now,
    updatedAt: now,
  };
  await kv.set(KEY, [...list, contract].slice(-MAX));
  return contract;
}

export async function updateContract(
  id: string,
  patch: Partial<ContractInput>
): Promise<ExpectedContract | null> {
  const list = await getContracts();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
  await kv.set(KEY, list);
  return list[idx];
}

export async function deleteContract(id: string): Promise<boolean> {
  const list = await getContracts();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  await kv.set(KEY, next);
  return true;
}

/** Probability weight for a contract (won=1, lost=0, else probability/100). */
export function weightOf(c: ExpectedContract): number {
  if (c.status === "won") return 1;
  if (c.status === "lost") return 0;
  return Math.max(0, Math.min(100, c.probability)) / 100;
}
