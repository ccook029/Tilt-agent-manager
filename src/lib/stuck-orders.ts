// ---------------------------------------------------------------------------
// stuck-orders.ts (hub side) — Penny's view of paid orders with no paperwork.
//
// The orders and the sync both live on tiltweb; this is the client. Two calls:
// list what's stuck, and push the button on one of them.
//
// Errors are returned, never thrown and never swallowed into an empty list. An
// empty stuck list means "nothing is stuck", which is the single most
// reassuring thing this screen can say — so it must never be what a failed
// call looks like.
// ---------------------------------------------------------------------------
import { fetchWithKey } from "./custom-queue";

const TILTWEB_URL =
  process.env.NEXT_PUBLIC_TILTWEB_URL?.replace(/\/$/, "") ||
  "https://www.tilthockey.com";

export interface StuckOrder {
  id: string;
  orderNumber: string;
  paymentIntentId: string;
  customerName: string;
  customerEmail: string;
  total: number;
  currency: string;
  status: string;
  createdAt: string;
  missing: ("invoice" | "salesOrder")[];
  summary: string;
}

export interface RetryOutcome {
  ok: boolean;
  error?: string;
  invoice?: { success: boolean; number: string | null; alreadyExisted: boolean; error: string | null };
  salesOrder?: { success: boolean; number: string | null; alreadyExisted: boolean; error: string | null };
}

function key(): string | null {
  return process.env.MODULES_SHARED_KEY || null;
}

export async function fetchStuckOrders(): Promise<
  { stuck: StuckOrder[]; scanned: number } | { error: string }
> {
  const k = key();
  if (!k) return { error: "MODULES_SHARED_KEY is not set on the hub." };
  try {
    const res = await fetchWithKey(`${TILTWEB_URL}/api/modules/stuck-orders`, k);
    if (!res.ok) {
      return {
        error:
          res.status === 401
            ? "tiltweb rejected the hub's key (401). MODULES_SHARED_KEY doesn't match."
            : `tiltweb returned ${res.status}.`,
      };
    }
    const j = (await res.json()) as { ok?: boolean; stuck?: StuckOrder[]; scanned?: number };
    if (!j.ok || !Array.isArray(j.stuck)) return { error: "Unreadable response from tiltweb." };
    return { stuck: j.stuck, scanned: j.scanned ?? 0 };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Re-run the Zoho sync for one order. Safe to press twice — the sync skips
 *  anything already created rather than duplicating it. */
export async function retryOrderSync(paymentIntentId: string): Promise<RetryOutcome> {
  const k = key();
  if (!k) return { ok: false, error: "MODULES_SHARED_KEY is not set on the hub." };
  try {
    const res = await fetchWithKey(`${TILTWEB_URL}/api/modules/stuck-orders`, k, 0, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentIntentId }),
    });
    const j = (await res.json()) as RetryOutcome;
    if (!res.ok && !j?.error) return { ok: false, error: `tiltweb returned ${res.status}.` };
    return j;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One line saying how a retry went, in the terms Penny would use. */
export function describeRetry(r: RetryOutcome): string {
  if (r.error) return r.error;
  const bits: string[] = [];
  if (r.invoice) {
    bits.push(
      r.invoice.success
        ? `Invoice ${r.invoice.number ?? "created"}${r.invoice.alreadyExisted ? " (already existed)" : ""}`
        : `Invoice failed — ${r.invoice.error ?? "no reason given"}`
    );
  }
  if (r.salesOrder) {
    bits.push(
      r.salesOrder.success
        ? `Sales order ${r.salesOrder.number ?? "created"}${r.salesOrder.alreadyExisted ? " (already existed)" : ""}`
        : `Sales order failed — ${r.salesOrder.error ?? "no reason given"}`
    );
  }
  return bits.join(" · ") || "Nothing came back.";
}
