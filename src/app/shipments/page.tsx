"use client";

// ---------------------------------------------------------------------------
// /shipments — the shipment register. Drop in a tracking number + expected
// date as factories send product; the Supply Chain Coordinator watches each
// against its timeline, flags at-risk/overdue, and drafts vendor check-ins.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Shipment {
  id: string;
  vendor: string;
  reference: string;
  trackingNumber?: string;
  carrier?: string;
  origin?: string;
  method?: string;
  expectedDate?: string;
  status: string;
  notes?: string;
  updatedAt: string;
}

const STATUSES = ["created", "in_transit", "customs", "delivered", "delayed"];

function etaFlag(s: Shipment): { label: string; tone: string } {
  if (s.status === "delivered") return { label: "delivered", tone: "text-gray-500" };
  if (!s.expectedDate) return { label: "no ETA set", tone: "text-gray-500" };
  const days = Math.round(
    (Date.parse(`${s.expectedDate}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) /
      86_400_000
  );
  if (days < 0) return { label: `overdue ${-days}d`, tone: "text-red-400" };
  if (days <= 10) return { label: `due in ${days}d`, tone: "text-amber-400" };
  return { label: `due in ${days}d`, tone: "text-gray-400" };
}

export default function ShipmentsPage() {
  const [rows, setRows] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    vendor: "",
    reference: "",
    trackingNumber: "",
    carrier: "",
    origin: "",
    method: "sea",
    expectedDate: "",
    notes: "",
  });

  const load = useCallback(async () => {
    const d = await fetch("/api/supply/shipments").then((r) => r.json()).catch(() => ({}));
    setRows(d.shipments ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!form.vendor.trim() || !form.reference.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/supply/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ vendor: "", reference: "", trackingNumber: "", carrier: "", origin: "", method: "sea", expectedDate: "", notes: "" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    await fetch("/api/supply/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/supply/shipments?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  };

  const input = "rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-xs text-gray-200 focus:border-[#00d6ff] focus:outline-none";

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Shipments</h1>
          <p className="mt-1 text-sm text-gray-500">
            Log a tracking number and expected date as each factory ships. Piers
            (Supply Chain) watches these against their timelines and flags what's
            at risk.
          </p>
        </div>
        <Link href="/org#operations" className="rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700">
          ← Operations
        </Link>
      </div>

      {/* Add form */}
      <section className="space-y-3 rounded-xl border border-gray-800/60 bg-[#111]/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#00d6ff]">Add a shipment</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <input className={input} placeholder="Vendor (e.g. Tack Enterprises)" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          <input className={`${input} col-span-1 sm:col-span-2`} placeholder="For (e.g. Lucan Irish — Jerseys)" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <input className={input} placeholder="Tracking #" value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} />
          <input className={input} placeholder="Carrier (e.g. Maersk)" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} />
          <input className={input} placeholder="Origin (e.g. China)" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} />
          <select className={input} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            <option value="sea">sea</option>
            <option value="air">air</option>
            <option value="courier">courier</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            ETA
            <input type="date" className={input} value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} />
          </label>
          <input className={`${input} col-span-2 sm:col-span-3`} placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <button onClick={add} disabled={busy || !form.vendor.trim() || !form.reference.trim()} className="rounded-md bg-[#0094b8] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#00a8d1] disabled:opacity-40">
          {busy ? "Adding…" : "Add shipment"}
        </button>
      </section>

      {/* Register */}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">
          No shipments yet. Add one above as soon as a factory sends a tracking number.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => {
            const flag = etaFlag(s);
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-800/60 bg-[#0d0d0d] p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-100">
                    {s.vendor} <span className="text-gray-500">— {s.reference}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    {s.trackingNumber ? `#${s.trackingNumber}` : "no tracking #"}
                    {s.carrier ? ` · ${s.carrier}` : ""}
                    {s.method ? ` · ${s.method}` : ""}
                    {s.origin ? ` · ${s.origin}` : ""}
                    {s.expectedDate ? ` · ETA ${s.expectedDate}` : ""}
                  </p>
                  {s.notes && <p className="mt-0.5 text-[11px] text-gray-600">{s.notes}</p>}
                </div>
                <span className={`shrink-0 text-[11px] font-semibold ${flag.tone}`}>{flag.label}</span>
                <select value={s.status} onChange={(e) => setStatus(s.id, e.target.value)} className={input}>
                  {STATUSES.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
                <button onClick={() => remove(s.id)} className="shrink-0 text-[11px] text-gray-600 hover:text-red-400">
                  remove
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
