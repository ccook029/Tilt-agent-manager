// ---------------------------------------------------------------------------
// supply/shipments.ts — the shipment register (Vercel KV).
//
// Where Tilt records every factory shipment: a tracking number, the vendor and
// order it's for, how it's moving, and when it's expected. The Supply Chain &
// Production Coordinator reads this to keep orders on their timeline — flagging
// anything at-risk or overdue and drafting vendor check-ins. Chris (or, later,
// a factory via a shared form) drops the tracking number in; the agent watches.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "supply-shipments";
const MAX_SHIPMENTS = 500;

export type ShipmentStatus =
  | "created" // logged, not yet moving
  | "in_transit" // on the water / in the air
  | "customs" // clearing customs
  | "delivered" // arrived
  | "delayed"; // known to be behind

export interface Shipment {
  id: string;
  vendor: string; // "Tack Enterprises", "Citi-Pro", …
  reference: string; // what it's for, e.g. "Lucan Irish — Jerseys"
  trackingNumber?: string;
  carrier?: string; // "Maersk", "DHL", "sea freight", …
  origin?: string; // "China", "Pakistan", …
  method?: "sea" | "air" | "courier";
  expectedDate?: string; // YYYY-MM-DD
  status: ShipmentStatus;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

async function loadAll(): Promise<Shipment[]> {
  return (await kv.get<Shipment[]>(KEY)) ?? [];
}

async function saveAll(rows: Shipment[]): Promise<void> {
  await kv.set(KEY, rows.slice(-MAX_SHIPMENTS));
}

export async function listShipments(): Promise<Shipment[]> {
  const rows = await loadAll();
  // Open shipments first (not delivered), then by soonest expected date.
  return rows.sort((a, b) => {
    const aOpen = a.status !== "delivered" ? 0 : 1;
    const bOpen = b.status !== "delivered" ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return (a.expectedDate ?? "9999").localeCompare(b.expectedDate ?? "9999");
  });
}

export async function createShipment(input: {
  vendor: string;
  reference: string;
  trackingNumber?: string;
  carrier?: string;
  origin?: string;
  method?: Shipment["method"];
  expectedDate?: string;
  status?: ShipmentStatus;
  notes?: string;
  createdBy?: string;
}): Promise<Shipment> {
  const now = new Date().toISOString();
  const row: Shipment = {
    id: `ship-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    vendor: input.vendor.trim(),
    reference: input.reference.trim(),
    trackingNumber: input.trackingNumber?.trim() || undefined,
    carrier: input.carrier?.trim() || undefined,
    origin: input.origin?.trim() || undefined,
    method: input.method,
    expectedDate: input.expectedDate?.trim() || undefined,
    status: input.status ?? "created",
    notes: input.notes?.trim() || undefined,
    createdBy: input.createdBy?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  const all = await loadAll();
  await saveAll([...all, row]);
  return row;
}

export async function updateShipment(
  id: string,
  patch: Partial<Omit<Shipment, "id" | "createdAt">>
): Promise<Shipment | null> {
  const all = await loadAll();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  await saveAll(all);
  return all[idx];
}

export async function deleteShipment(id: string): Promise<boolean> {
  const all = await loadAll();
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  await saveAll(next);
  return true;
}

/** Days from `today` until an expected date (negative = overdue). */
function daysUntil(expected: string | undefined, todayIso: string): number | null {
  if (!expected) return null;
  const ms = Date.parse(`${expected}T00:00:00Z`) - Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

/**
 * A readable snapshot of open shipments and their timeline health, for the
 * coordinator's context. Marks anything overdue or due within 10 days.
 */
export async function renderShipmentsSnapshot(): Promise<string> {
  const rows = await listShipments();
  const open = rows.filter((s) => s.status !== "delivered");
  if (open.length === 0) {
    return "(no open shipments in the register — add tracking numbers on the Shipments page as factories send them)";
  }
  const today = new Date().toISOString();
  return open
    .map((s) => {
      const d = daysUntil(s.expectedDate, today);
      const flag =
        d === null
          ? "no expected date set"
          : d < 0
            ? `OVERDUE by ${-d} day(s)`
            : d <= 10
              ? `due in ${d} day(s) — check in`
              : `due in ${d} day(s)`;
      const bits = [
        `${s.vendor} — ${s.reference}`,
        `[${s.status}]`,
        s.trackingNumber ? `track ${s.trackingNumber}` : "no tracking #",
        s.carrier ?? "",
        s.method ?? "",
        s.expectedDate ? `ETA ${s.expectedDate}` : "",
        `⇒ ${flag}`,
      ].filter(Boolean);
      return `- ${bits.join(" · ")}${s.notes ? `\n    note: ${s.notes}` : ""}`;
    })
    .join("\n");
}
