"use client";

// ---------------------------------------------------------------------------
// /inventory/cleanup — retire legacy stick SKUs that show stock we don't have.
//
// Stockton's data, your finger on the button: the list is every active
// TILT-* stick SKU that isn't one of the 12 live ones. Review it, untick
// anything that shouldn't go, and retire the rest — stock zeroed via a
// normal adjustment, item marked inactive. Both reversible from Zoho.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";

interface LegacyItem {
  itemId: string;
  sku: string;
  name: string;
  stockOnHand: number;
  phantomValue: number;
}

interface RetireResult {
  itemId: string;
  sku: string;
  name: string;
  stockZeroed: number;
  zeroed: boolean;
  deactivated: boolean;
  error?: string;
}

export default function LegacyCleanupPage() {
  const [items, setItems] = useState<LegacyItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RetireResult[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/legacy-cleanup");
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Failed to load");
      setItems(j.items);
      // Everything selected by default — this page exists to clean house.
      setSelected(new Set((j.items as LegacyItem[]).map((i) => i.itemId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stats = useMemo(() => {
    const chosen = (items ?? []).filter((i) => selected.has(i.itemId));
    return {
      count: chosen.length,
      units: chosen.reduce((s, i) => s + i.stockOnHand, 0),
    };
  }, [items, selected]);

  async function retire() {
    if (stats.count === 0) return;
    if (
      !confirm(
        `Retire ${stats.count} legacy SKUs?\n\nTheir stock (${stats.units} phantom units) is zeroed and the items are marked inactive in Zoho. Reversible from the Zoho UI.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/legacy-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: Array.from(selected) }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Cleanup failed");
      setResults(j.results);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cleanup failed");
    } finally {
      setBusy(false);
    }
  }

  const failed = (results ?? []).filter((r) => !r.deactivated);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-200">Legacy SKU Cleanup</h2>
          <p className="text-sm text-gray-500 mt-1">
            Old stick models still showing stock in Zoho that doesn&apos;t exist.
            Retiring zeroes the count and hides the SKU — the 12 live sticks
            can&apos;t be touched from here.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading || busy}
          className="bg-[#101010] border border-gray-800 text-gray-300 py-2 px-4 rounded-lg text-sm font-medium hover:border-gray-700 hover:text-gray-100 disabled:opacity-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      {results && (
        <div
          className={`mb-6 rounded-xl border p-4 text-sm ${
            failed.length === 0
              ? "border-green-800/60 bg-green-950/30 text-green-200"
              : "border-amber-800/60 bg-amber-950/30 text-amber-200"
          }`}
        >
          <p className="font-semibold">
            Retired {results.filter((r) => r.deactivated).length} SKUs, zeroed{" "}
            {results.reduce((s, r) => s + r.stockZeroed, 0)} phantom units.
            {failed.length > 0 && ` ${failed.length} failed:`}
          </p>
          {failed.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {failed.map((r) => (
                <li key={r.itemId}>
                  <span className="font-mono">{r.sku}</span> — {r.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-800/60 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 overflow-hidden">
        {loading ? (
          <p className="px-5 py-8 text-sm text-gray-600">Loading legacy SKUs…</p>
        ) : !items || items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-600">
            No legacy stick SKUs left to retire — the catalog is clean.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800/80 text-left text-xs uppercase tracking-wide text-gray-600">
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === items.length}
                    onChange={() =>
                      setSelected(
                        selected.size === items.length
                          ? new Set()
                          : new Set(items.map((i) => i.itemId))
                      )
                    }
                  />
                </th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-right">Phantom stock</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr
                  key={i.itemId}
                  className="border-b border-gray-900/60 hover:bg-white/[0.02] cursor-pointer"
                  onClick={() => toggle(i.itemId)}
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(i.itemId)}
                      onChange={() => toggle(i.itemId)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-gray-300">{i.sku}</td>
                  <td className="px-4 py-2.5 text-gray-400">{i.name}</td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono ${
                      i.stockOnHand !== 0 ? "text-amber-300" : "text-gray-600"
                    }`}
                  >
                    {i.stockOnHand}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {items && items.length > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {stats.count} of {items.length} selected · {stats.units} phantom
            units to zero
          </p>
          <button
            onClick={() => void retire()}
            disabled={busy || stats.count === 0}
            className="rounded-lg bg-[#00d6ff] px-5 py-2.5 text-sm font-semibold text-black hover:bg-[#00d6ff]/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Retiring…" : `Zero & retire ${stats.count} SKUs`}
          </button>
        </div>
      )}
    </div>
  );
}
