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
  category: string;
  tiltSku: boolean;
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
  const [withStockOnly, setWithStockOnly] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/legacy-cleanup");
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Failed to load");
      setItems(j.items);
      // Nothing selected by default. This list is the whole catalog minus the
      // 12 live sticks, so it holds real inventory as well as dead models —
      // retiring is a decision per row, not a default.
      setSelected(new Set());
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((i) => {
      if (withStockOnly && i.stockOnHand === 0) return false;
      if (!q) return true;
      return (
        i.sku.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
      );
    });
  }, [items, withStockOnly, query]);

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
        `Retire ${stats.count} items?\n\nTheir stock (${stats.units} units) is zeroed and the items are marked inactive in Zoho. Reversible from the Zoho UI.`
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
            Every active Zoho item except the 12 live stick SKUs, which
            can&apos;t be touched from here. Old models sit alongside real
            grips and apparel — tick only what should go. Retiring zeroes the
            count and marks the item inactive; both undo from Zoho.
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

      {items && items.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by SKU, name, or category…"
            className="flex-1 min-w-[220px] rounded-lg border border-gray-800 bg-[#101010] px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-[#00d6ff]/50 focus:outline-none"
          />
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={withStockOnly}
              onChange={(e) => setWithStockOnly(e.target.checked)}
            />
            Only items with stock
          </label>
          <span className="text-xs text-gray-600">
            {visible.length} of {items.length} shown
          </span>
        </div>
      )}

      <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 overflow-hidden">
        {loading ? (
          <p className="px-5 py-8 text-sm text-gray-600">Loading catalog…</p>
        ) : !items || items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-600">
            Nothing retirable — every active item is one of the 12 live stick
            SKUs.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-600">
            No items match those filters. Untick &ldquo;only items with
            stock&rdquo; to see the rest of the catalog.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800/80 text-left text-xs uppercase tracking-wide text-gray-600">
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    title="Select everything currently shown"
                    checked={
                      visible.length > 0 &&
                      visible.every((i) => selected.has(i.itemId))
                    }
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const i of visible) {
                          if (e.target.checked) next.add(i.itemId);
                          else next.delete(i.itemId);
                        }
                        return next;
                      })
                    }
                  />
                </th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Stock</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => (
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
                  <td className="px-4 py-2.5 font-mono text-gray-300">
                    {i.sku}
                    {i.tiltSku && (
                      <span
                        className="ml-2 rounded bg-[#00d6ff]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#00d6ff]"
                        title="Uses the current TILT- SKU convention"
                      >
                        Tilt
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400">{i.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{i.category}</td>
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
            {stats.count} selected · {stats.units} units to zero
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
