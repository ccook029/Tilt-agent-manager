"use client";

// ---------------------------------------------------------------------------
// /inventory/location — send stock to a retailer, or bring it back.
//
// Stockton works out exactly which rows would change; you read that and press
// push. Nothing is written until you do.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { KNOWN_LOCATIONS, TILT_HQ } from "@/lib/inventory-location";

interface Change {
  serial: string; from: string; to: string; tab: string;
  rowIndex: number; level: string; size: number; status: string;
}

interface PlanResponse {
  ok: boolean;
  error?: string;
  applied?: boolean;
  location?: string;
  summary?: string;
  written?: number;
  failed?: { serial: string; error: string }[];
  changes?: Change[];
  unchanged?: Change[];
  alreadySold?: Change[];
  notFound?: string[];
  duplicates?: string[];
  notYetBuilt?: string[];
}

export default function LocationPage() {
  const [serials, setSerials] = useState("");
  const [location, setLocation] = useState<string>(KNOWN_LOCATIONS[1]);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [busy, setBusy] = useState<"plan" | "apply" | null>(null);

  const count = serials.split(/\r?\n/).filter((l) => l.trim()).length;

  async function call(apply: boolean) {
    setBusy(apply ? "apply" : "plan");
    if (!apply) setPlan(null);
    try {
      const res = await fetch("/api/inventory/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serials, location, ...(apply ? { apply: 1 } : {}) }),
      });
      setPlan(await res.json());
    } catch (err) {
      setPlan({ ok: false, error: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-200">Stock Location</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Consignment stock sits at a retailer but is still Tilt&apos;s until it
          sells, so it stays <strong className="text-gray-300">Available</strong>
          {" "}— the location says which building it&apos;s in, not whether
          it&apos;s for sale. Stockton works out what would change; you push it.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-4">
        <label className="mb-1 block text-xs uppercase tracking-wider text-gray-500">
          Move to
        </label>
        <input
          list="tilt-locations"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="mb-3 w-full max-w-md rounded-lg border border-gray-800 bg-[#0c0c0c] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#00d6ff]/50"
        />
        <datalist id="tilt-locations">
          {KNOWN_LOCATIONS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>

        <label className="mb-1 block text-xs uppercase tracking-wider text-gray-500">
          Serials — one per line
        </label>
        <textarea
          value={serials}
          onChange={(e) => setSerials(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={"H2607-09684\nH2512-00270\nH202604-05359"}
          className="w-full rounded-lg border border-gray-800 bg-[#0c0c0c] p-3 font-mono text-sm text-gray-200 outline-none focus:border-[#00d6ff]/50"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => call(false)}
            disabled={busy !== null || count === 0}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 disabled:opacity-40"
          >
            {busy === "plan" ? "Checking…" : `Check ${count || ""} serial${count === 1 ? "" : "s"}`}
          </button>

          {plan?.ok && !plan.applied && (plan.changes?.length ?? 0) > 0 && (
            <button
              onClick={() => call(true)}
              disabled={busy !== null}
              className="rounded-lg bg-[#0094b8] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy === "apply"
                ? "Writing…"
                : `Push ${plan.changes!.length} to ${plan.location}`}
            </button>
          )}
        </div>
      </div>

      {plan && !plan.ok && plan.error && (
        <p className="mt-4 rounded-xl border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-300">
          {plan.error}
        </p>
      )}

      {plan?.ok && (
        <div className="mt-6 space-y-5">
          <div className="rounded-xl border border-gray-800/80 bg-[#101010]/80 p-3 text-sm">
            {plan.applied ? (
              <span className="text-emerald-300">
                Written: {plan.written} stick{plan.written === 1 ? "" : "s"} now at{" "}
                {plan.location}.
              </span>
            ) : (
              <span className="text-gray-300">{plan.summary} — nothing written yet.</span>
            )}
          </div>

          {plan.failed && plan.failed.length > 0 && (
            <Block tone="bad" title={`${plan.failed.length} failed to write`}>
              <ul className="space-y-1 text-xs">
                {plan.failed.map((f) => (
                  <li key={f.serial} className="text-red-300">
                    <span className="font-mono">{f.serial}</span> — {f.error}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {(plan.changes?.length ?? 0) > 0 && (
            <Block
              tone="ok"
              title={`${plan.changes!.length} will move`}
              blurb={plan.applied ? undefined : "These are the rows that get written."}
            >
              <Table rows={plan.changes!} />
            </Block>
          )}

          {(plan.alreadySold?.length ?? 0) > 0 && (
            <Block
              tone="warn"
              title={`${plan.alreadySold!.length} already sold — held back`}
              blurb="A sold stick has left the building. Almost always a mistyped serial, so these are never written."
            >
              <Table rows={plan.alreadySold!} />
            </Block>
          )}

          {(plan.unchanged?.length ?? 0) > 0 && (
            <Block tone="plain" title={`${plan.unchanged!.length} already there`}>
              <Table rows={plan.unchanged!} />
            </Block>
          )}

          {(plan.notFound?.length ?? 0) > 0 && (
            <Block
              tone="bad"
              title={`${plan.notFound!.length} not on the sheet`}
              blurb="No row to update. Check the label, or add the stick first."
            >
              <p className="font-mono text-xs text-red-300">
                {plan.notFound!.join(", ")}
              </p>
            </Block>
          )}

          {(plan.notYetBuilt?.length ?? 0) > 0 && (
            <Block tone="plain" title={`${plan.notYetBuilt!.length} not built yet`}
              blurb="Still at the factory — a location would mean nothing.">
              <p className="font-mono text-xs text-gray-500">
                {plan.notYetBuilt!.join(", ")}
              </p>
            </Block>
          )}

          {(plan.duplicates?.length ?? 0) > 0 && (
            <Block tone="warn" title={`${plan.duplicates!.length} listed twice`}>
              <p className="font-mono text-xs text-amber-300">
                {plan.duplicates!.join(", ")}
              </p>
            </Block>
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-gray-700">
        Blank means {TILT_HQ}. Existing rows stay blank rather than being
        rewritten — every read treats blank as {TILT_HQ}.
      </p>
    </div>
  );
}

function Table({ rows }: { rows: Change[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-gray-600">
          <tr>
            <th className="py-1 pr-3">Serial</th><th className="pr-3">Level</th>
            <th className="pr-3">Size</th><th className="pr-3">Status</th>
            <th className="pr-3">From</th><th>To</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={`${c.tab}-${c.rowIndex}`} className="border-t border-gray-900">
              <td className="py-1.5 pr-3 font-mono text-gray-200">{c.serial}</td>
              <td className="pr-3 text-gray-400">{c.level}</td>
              <td className="pr-3 text-gray-400">{c.size}</td>
              <td className="pr-3 text-gray-500">{c.status}</td>
              <td className="pr-3 text-gray-500">{c.from}</td>
              <td className="text-[#00d6ff]/80">{c.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({
  title, blurb, tone, children,
}: {
  title: string; blurb?: string;
  tone: "ok" | "warn" | "bad" | "plain";
  children: React.ReactNode;
}) {
  const border =
    tone === "bad" ? "border-red-900/50"
    : tone === "warn" ? "border-amber-900/50"
    : tone === "ok" ? "border-[#00d6ff]/25"
    : "border-gray-800/80";
  return (
    <div className={`rounded-2xl border ${border} bg-[#101010]/80 p-4`}>
      <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      {blurb && <p className="mt-0.5 mb-3 text-xs text-gray-600">{blurb}</p>}
      {children}
    </div>
  );
}
