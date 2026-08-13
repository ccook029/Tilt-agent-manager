"use client";

// ---------------------------------------------------------------------------
// /inventory/actions — staged Zoho changes, pushed by the owner.
//
// Batches are authored in the repo (src/lib/zoho-actions.ts) and resolved
// against the live catalog here, so the list on screen is what the button
// acts on — not a snapshot from whenever the batch was written.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

interface MatchedItem {
  itemId: string;
  sku: string;
  name: string;
  stockOnHand: number;
}

interface Batch {
  id: string;
  title: string;
  note: string;
  namePrefixes: string[];
  matched: MatchedItem[];
  inactiveWithStock: MatchedItem[];
  alreadyDone: number;
  protectedFromMatch: string[];
  itemsScanned: number;
  totalUnits: number;
}

interface ApplyResult {
  retired: number;
  failed: number;
  unitsZeroed: number;
  inactiveCleared?: number;
  inactiveError?: string;
  note?: string;
  results?: { sku: string; deactivated: boolean; error?: string }[];
}

export default function ZohoActionsPage() {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Record<string, ApplyResult>>({});
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/actions");
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Failed to load");
      setBatches(j.batches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(batch: Batch) {
    if (
      !confirm(
        `${batch.title}\n\n${batch.matched.length} items will have their stock zeroed and be marked inactive in Zoho.\n\nReversible from the Zoho UI.`
      )
    )
      return;
    setBusy(batch.id);
    setError(null);
    try {
      const res = await fetch("/api/inventory/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: batch.id }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Push failed");
      setApplied((prev) => ({ ...prev, [batch.id]: j as ApplyResult }));
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-200">Staged Zoho Changes</h2>
          <p className="text-sm text-gray-500 mt-1">
            Catalog changes worked out in advance and matched against Zoho live.
            Review what each one caught, then push it.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading || busy !== null}
          className="bg-[#101010] border border-gray-800 text-gray-300 py-2 px-4 rounded-lg text-sm font-medium hover:border-gray-700 hover:text-gray-100 disabled:opacity-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-800/60 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-600">Matching against Zoho…</p>
      ) : (batches ?? []).length === 0 ? (
        <p className="text-sm text-gray-600">No staged changes right now.</p>
      ) : (
        <div className="space-y-4">
          {(batches ?? []).map((batch) => {
            const result = applied[batch.id];
            const actionable = batch.matched.length + batch.inactiveWithStock.length;
            const nothing = actionable === 0;
            const rows = [...batch.matched, ...batch.inactiveWithStock];
            return (
              <div
                key={batch.id}
                className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 overflow-hidden"
              >
                <div className="flex items-start justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-200">{batch.title}</h3>
                    <p className="mt-1 text-sm text-gray-500">{batch.note}</p>
                    <p className="mt-2 text-sm text-gray-400">
                      {nothing ? (
                        <span className="text-gray-600">
                          Nothing left to do
                          {batch.alreadyDone > 0
                            ? ` — ${batch.alreadyDone} already retired and sitting at zero.`
                            : " — no items matched these names."}
                        </span>
                      ) : (
                        <>
                          <span className="text-[#00d6ff]">{actionable} items</span> ·{" "}
                          {batch.totalUnits} units of stock to clear
                        </>
                      )}
                    </p>
                    {/* Say what was looked at. "Nothing matched" on its own
                        can't tell a clean catalog from a failed fetch. */}
                    <p className="mt-1 text-xs text-gray-600">
                      Scanned {batch.itemsScanned} items · matching:{" "}
                      {batch.namePrefixes.join(", ")}
                    </p>
                    {batch.matched.length > 0 && (
                      <p className="mt-1 text-xs text-gray-500">
                        {batch.matched.length} active → stock zeroed, then made inactive
                      </p>
                    )}
                    {batch.inactiveWithStock.length > 0 && (
                      <p className="mt-1 text-xs text-gray-500">
                        {batch.inactiveWithStock.length} already inactive but still
                        holding stock → counts cleared
                      </p>
                    )}
                    {batch.alreadyDone > 0 && actionable > 0 && (
                      <p className="mt-1 text-xs text-gray-600">
                        {batch.alreadyDone} already done
                      </p>
                    )}
                    {batch.protectedFromMatch.length > 0 && (
                      <p className="mt-2 text-xs text-amber-400">
                        Skipped {batch.protectedFromMatch.length} live stick SKUs:{" "}
                        {batch.protectedFromMatch.join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {result ? (
                      <span
                        className={`inline-block max-w-[280px] rounded-lg border px-3 py-2 text-sm ${
                          result.failed === 0 && !result.inactiveError
                            ? "border-green-800/60 bg-green-950/40 text-green-300"
                            : "border-amber-800/60 bg-amber-950/40 text-amber-200"
                        }`}
                      >
                        {result.retired} retired · {result.unitsZeroed} units cleared
                        {result.failed > 0 && `, ${result.failed} failed`}
                        {result.inactiveError && (
                          <span className="mt-1 block text-xs">
                            Inactive items not cleared: {result.inactiveError}
                          </span>
                        )}
                      </span>
                    ) : (
                      <button
                        onClick={() => void apply(batch)}
                        disabled={busy !== null || nothing}
                        className="rounded-lg bg-[#00d6ff] px-4 py-2.5 text-sm font-semibold text-black hover:bg-[#00d6ff]/90 disabled:opacity-50 transition-colors"
                      >
                        {busy === batch.id ? "Pushing…" : "Push to Zoho"}
                      </button>
                    )}
                  </div>
                </div>

                {!nothing && (
                  <>
                    <button
                      onClick={() => setOpen(open === batch.id ? null : batch.id)}
                      className="w-full border-t border-gray-800/80 px-5 py-2.5 text-left text-xs text-gray-500 hover:text-gray-300"
                    >
                      {open === batch.id ? "Hide" : "Show"} the {rows.length} items
                    </button>
                    {open === batch.id && (
                      <div className="max-h-96 overflow-y-auto border-t border-gray-900/60">
                        <table className="w-full text-sm">
                          <tbody>
                            {rows.map((m) => (
                              <tr key={m.itemId} className="border-b border-gray-900/60">
                                <td className="px-5 py-2 text-gray-300">{m.name}</td>
                                <td className="px-5 py-2 font-mono text-gray-600">{m.sku}</td>
                                <td
                                  className={`px-5 py-2 text-right font-mono ${
                                    m.stockOnHand < 0
                                      ? "text-red-400"
                                      : m.stockOnHand > 0
                                        ? "text-amber-300"
                                        : "text-gray-700"
                                  }`}
                                >
                                  {m.stockOnHand}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
