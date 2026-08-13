"use client";

// ---------------------------------------------------------------------------
// /inventory/apparel — create Zoho item groups for apparel, one at a time.
//
// Creation is one-way: Zoho can't restructure a group afterwards or convert
// standalone items into one. So the plan is always on screen, each group has
// its own button, and the confirm spells out what can't be undone.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

interface Variant {
  sku: string;
  name: string;
  colour: string;
  size: string;
  rate: number;
}

interface PlannedGroup {
  productId: string;
  groupName: string;
  attributes: { name: string; options: string[] }[];
  variants: Variant[];
  problems: string[];
}

interface CreateResult {
  productId: string;
  groupName: string;
  created: boolean;
  groupId?: string;
  variantCount: number;
  error?: string;
}

export default function ApparelGroupsPage() {
  const [plan, setPlan] = useState<PlannedGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CreateResult[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/apparel-groups");
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Failed to load the plan");
      setPlan(j.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the plan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(group: PlannedGroup) {
    if (
      !confirm(
        `Create "${group.groupName}" in Zoho with ${group.variants.length} variants, all at zero stock?\n\nZoho can't restructure a group after it's created — attribute names and the colour/size lists are fixed from here.`
      )
    )
      return;
    setBusy(group.productId);
    setError(null);
    try {
      const res = await fetch("/api/inventory/apparel-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [group.productId] }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Creation failed");
      setResults((prev) => [...prev, ...(j.results as CreateResult[])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setBusy(null);
    }
  }

  const resultFor = (productId: string) =>
    results.find((r) => r.productId === productId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-200">Apparel Item Groups</h2>
          <p className="text-sm text-gray-500 mt-1">
            One Zoho group per product, expandable to colour × size variants.
            Everything starts at zero stock. Create one, check it in Zoho, then
            do the next.
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
        <p className="text-sm text-gray-600">Loading the plan…</p>
      ) : (
        <div className="space-y-4">
          {(plan ?? []).map((group) => {
            const result = resultFor(group.productId);
            const blocked = group.problems.length > 0;
            return (
              <div
                key={group.productId}
                className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 overflow-hidden"
              >
                <div className="flex items-start justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-200">{group.groupName}</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {group.attributes
                        .map((a) => `${a.name}: ${a.options.join(", ")}`)
                        .join(" · ")}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {group.variants.length} variants · $
                      {group.variants[0]?.rate.toFixed(2)} each · stock 0
                    </p>
                    {blocked && (
                      <ul className="mt-2 space-y-1 text-xs text-red-400">
                        {group.problems.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {result?.created ? (
                      <span className="inline-block rounded-lg border border-green-800/60 bg-green-950/40 px-3 py-2 text-sm text-green-300">
                        Created in Zoho
                      </span>
                    ) : result ? (
                      <span className="inline-block max-w-[260px] rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                        {result.error}
                      </span>
                    ) : (
                      <button
                        onClick={() => void create(group)}
                        disabled={busy !== null || blocked}
                        className="rounded-lg bg-[#00d6ff] px-4 py-2.5 text-sm font-semibold text-black hover:bg-[#00d6ff]/90 disabled:opacity-50 transition-colors"
                      >
                        {busy === group.productId ? "Creating…" : "Create in Zoho"}
                      </button>
                    )}
                  </div>
                </div>

                <button
                  onClick={() =>
                    setExpanded(expanded === group.productId ? null : group.productId)
                  }
                  className="w-full border-t border-gray-800/80 px-5 py-2.5 text-left text-xs text-gray-500 hover:text-gray-300"
                >
                  {expanded === group.productId ? "Hide" : "Show"} the{" "}
                  {group.variants.length} SKUs
                </button>

                {expanded === group.productId && (
                  <div className="max-h-72 overflow-y-auto border-t border-gray-900/60">
                    <table className="w-full text-sm">
                      <tbody>
                        {group.variants.map((v) => (
                          <tr key={v.sku} className="border-b border-gray-900/60">
                            <td className="px-5 py-2 font-mono text-gray-300">{v.sku}</td>
                            <td className="px-5 py-2 text-gray-500">
                              {v.colour} · {v.size}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
