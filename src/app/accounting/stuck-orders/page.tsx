"use client";

// ---------------------------------------------------------------------------
// /accounting/stuck-orders — paid, but Zoho never heard about it.
//
// One row per order, one button per row. The button re-runs the same sync the
// checkout webhook runs, so pressing it twice is harmless: anything already
// created is skipped rather than duplicated.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

interface StuckOrder {
  id: string;
  orderNumber: string;
  paymentIntentId: string;
  customerName: string;
  customerEmail: string;
  total: number;
  currency: string;
  createdAt: string;
  missing: ("invoice" | "salesOrder")[];
  summary: string;
}

function age(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "under an hour";
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.floor(h / 24)} days`;
}

export default function StuckOrdersPage() {
  const [orders, setOrders] = useState<StuckOrder[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const j = await fetch("/api/accounting/stuck-orders").then((r) => r.json());
      if (!j.ok) {
        setError(j.error ?? "Couldn't reach the store.");
        setOrders(null);
        return;
      }
      setOrders(j.stuck ?? []);
      setScanned(j.scanned ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the store.");
      setOrders(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(o: StuckOrder) {
    setBusy(o.paymentIntentId);
    try {
      const j = await fetch("/api/accounting/stuck-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId: o.paymentIntentId }),
      }).then((r) => r.json());
      setResults((cur) => ({
        ...cur,
        [o.paymentIntentId]: { ok: Boolean(j.ok), message: j.message ?? j.error ?? "No answer." },
      }));
      // A successful retry drops the order off the list — reload so the queue
      // reflects what's actually left rather than what was there a minute ago.
      if (j.ok) void load();
    } catch (err) {
      setResults((cur) => ({
        ...cur,
        [o.paymentIntentId]: {
          ok: false,
          message: err instanceof Error ? err.message : "The retry failed.",
        },
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-200">Stuck Orders</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Orders the customer paid for that never got their Zoho paperwork. The
          checkout webhook doesn&apos;t retry these — it returns OK to Stripe on
          purpose, so a bookkeeping problem can&apos;t hold up a customer&apos;s
          confirmation email. Which means clearing them is a button, and this is
          the button.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {orders === null && !error && (
        <p className="text-sm text-gray-600">Checking…</p>
      )}

      {orders?.length === 0 && (
        <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-6 text-center">
          <p className="text-sm text-gray-300">Nothing is stuck.</p>
          <p className="mt-1 text-xs text-gray-600">
            All {scanned} orders checked have their invoice and sales order in Zoho.
          </p>
        </div>
      )}

      {orders && orders.length > 0 && (
        <>
          <p className="mb-3 text-xs text-gray-600">
            {orders.length} of {scanned} orders need attention.
          </p>
          <div className="space-y-3">
            {orders.map((o) => {
              const r = results[o.paymentIntentId];
              return (
                <div
                  key={o.id}
                  className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-gray-200">
                          {o.orderNumber}
                        </span>
                        <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-xs text-red-300">
                          {o.summary}
                        </span>
                        <span className="text-xs text-gray-600">
                          stuck {age(o.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-400">
                        {o.customerName || "—"}{" "}
                        <span className="text-gray-600">{o.customerEmail}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-gray-600">
                        ${o.total} {o.currency} ·{" "}
                        <span className="font-mono">{o.paymentIntentId}</span>
                      </p>
                    </div>

                    <button
                      onClick={() => retry(o)}
                      disabled={busy === o.paymentIntentId}
                      className="shrink-0 rounded-lg bg-[#0094b8] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {busy === o.paymentIntentId ? "Syncing…" : "Sync to Zoho"}
                    </button>
                  </div>

                  {r && (
                    <p
                      className={`mt-3 rounded-lg border p-2.5 text-xs ${
                        r.ok
                          ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-300"
                          : "border-red-900/60 bg-red-950/20 text-red-300"
                      }`}
                    >
                      {r.message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-gray-700">
        Pressing this twice is safe — the sync skips anything already in Zoho
        rather than creating it again.
      </p>
    </div>
  );
}
