"use client";

// ---------------------------------------------------------------------------
// ActionLedger — "what has the accounting team actually written to Zoho?"
// (audit item #19). Every executed change, newest first, each reversible with
// one click (calls uncategorizeTxn server-side). This is the safety net that
// makes autonomous execution comfortable: nothing is a black box, everything
// is undoable.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

interface WrittenAction {
  id: string;
  when: string;
  what: string;
  transaction: string;
  batch: string;
  reversed: boolean;
  reversedAt: string | null;
}

interface LedgerData {
  summary?: {
    writtenToBooks: number;
    proposedOrSkipped: number;
    verdict: string;
  };
  written?: WrittenAction[];
}

export default function ActionLedger() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/actions");
      if (!res.ok) {
        setError("Couldn't load the ledger.");
        return;
      }
      setError(null);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const undo = async (a: WrittenAction) => {
    if (!confirm(`Undo this change and return the transaction to Uncategorized?\n\n${a.what}`)) {
      return;
    }
    setUndoing(a.id);
    setError(null);
    try {
      const res = await fetch("/api/accounting/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: a.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Undo failed.");
        return;
      }
      await load();
    } finally {
      setUndoing(null);
    }
  };

  if (loading) return <p className="text-gray-500">Loading the ledger…</p>;

  const written = data?.written ?? [];
  const activeCount = written.filter((a) => !a.reversed).length;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
          Ledger of changes
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {data?.summary?.verdict ??
            "Every change written to Zoho Books, newest first — each reversible."}
          {data?.summary && data.summary.proposedOrSkipped > 0 && (
            <span className="text-gray-600">
              {" "}
              ({data.summary.proposedOrSkipped} proposed/skipped — nothing written.)
            </span>
          )}
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {written.length === 0 ? (
        <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">
          Nothing has been written to Zoho Books yet. When Penny executes a
          categorization, it shows here with an undo button.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800/70">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-gray-800/70 text-left text-xs uppercase tracking-wider text-gray-600">
                <th className="px-4 py-2.5 font-medium">Change</th>
                <th className="w-28 px-4 py-2.5 font-medium">When</th>
                <th className="w-28 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {written.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-gray-900 last:border-0 hover:bg-gray-900/40"
                >
                  <td className="px-4 py-3 text-gray-200">
                    {a.what}
                    {a.reversed && (
                      <span className="ml-2 rounded-full border border-gray-700 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-500">
                        Reversed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(a.when).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.reversed ? (
                      <span className="text-xs text-gray-600">done</span>
                    ) : (
                      <button
                        onClick={() => undo(a)}
                        disabled={undoing === a.id}
                        className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-red-500/60 hover:text-red-300 disabled:opacity-40"
                      >
                        {undoing === a.id ? "Undoing…" : "Undo"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {written.length > 0 && (
        <p className="text-xs text-gray-600">
          {activeCount} active change{activeCount === 1 ? "" : "s"} in Zoho Books.
        </p>
      )}
    </div>
  );
}
