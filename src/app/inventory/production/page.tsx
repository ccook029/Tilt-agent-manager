"use client";

// ---------------------------------------------------------------------------
// /inventory/production — sticks at the factory, not yet here.
//
// Upload the production list, give it a date, and it's tracked as quantities
// per spec. When the shipment lands, Receive Stock matches each real stick
// against these and draws them down.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

interface Line {
  level: string;
  size: string;
  carbon: string;
  kickPoint: string;
  hand: string;
  flex: string;
  curve: string;
  baseColor: string;
  decalColor: string;
  quantity: number;
  received: number;
  label?: string;
}

interface Preview {
  fileName: string;
  interpretation: string;
  warnings: string[];
  sticksFound: number;
  lines: Line[];
  excluded: { sourceRow: number; reason: string }[];
}

interface Batch {
  id: string;
  label: string;
  expectedDate: string;
  lines: Line[];
  closedAt?: string;
}

interface Outstanding extends Line {
  batchId: string;
  batchLabel: string;
  expectedDate: string;
  outstanding: number;
}

export default function ProductionPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [outstanding, setOutstanding] = useState<Outstanding[]>([]);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [instructions, setInstructions] = useState("");
  const [label, setLabel] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  /** Which batch is mid-listing, and the last result line per batch. */
  const [listing, setListing] = useState<string | null>(null);
  const [listedNote, setListedNote] = useState<Record<string, string>>({});
  /** Zoho sheet-write pre-flight: idle | checking | ok | error. */
  const [scope, setScope] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [scopeNote, setScopeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory/production");
      const j = await res.json();
      if (j.ok) {
        setBatches(j.batches ?? []);
        setOutstanding(j.outstanding ?? []);
        setTotalOutstanding(j.totalOutstanding ?? 0);
      }
    } catch {
      /* the list is a convenience; the upload path reports its own errors */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(f: File, notes = "") {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (notes.trim()) fd.append("instructions", notes.trim());
      const res = await fetch("/api/inventory/production", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Could not read that file");
      setPreview(j as Preview);
      if (!label) setLabel(f.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview || !label.trim() || !expectedDate) return;
    const total = preview.lines.reduce((s, l) => s + l.quantity, 0);
    if (!confirm(`Track ${total} sticks as in production, due ${expectedDate}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), expectedDate, lines: preview.lines }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Could not save");
      setSaved(`${j.total} sticks now tracked as in production.`);
      setPreview(null);
      setFile(null);
      setLabel("");
      setInstructions("");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function changeDate(id: string, current: string) {
    const next = prompt("New expected date (YYYY-MM-DD):", current);
    if (!next || next === current) return;
    await fetch("/api/inventory/production", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, expectedDate: next }),
    });
    void load();
  }

  /**
   * Put one sellable row per outstanding stick on the inventory sheet.
   *
   * Asks for the count first and confirms it, because this writes hundreds of
   * rows to the sheet the website sells from — nobody should learn the number
   * afterwards. Re-running is safe: rows already written for this batch are
   * skipped, not duplicated.
   */
  async function listForPreorder(id: string) {
    setListing(id);
    try {
      const pre = await fetch(
        `/api/inventory/preorder?batchId=${encodeURIComponent(id)}`
      ).then((r) => r.json());
      if (!pre.ok) {
        setListedNote((n) => ({ ...n, [id]: pre.error }));
        return;
      }
      if (pre.toWrite === 0) {
        setListedNote((n) => ({
          ...n,
          [id]:
            pre.alreadyWritten > 0
              ? `All ${pre.alreadyWritten} are already listed for pre-order.`
              : "Nothing outstanding to list.",
        }));
        return;
      }
      const already =
        pre.alreadyWritten > 0 ? ` (${pre.alreadyWritten} already listed)` : "";
      if (
        !confirm(
          `Put ${pre.toWrite} sticks on the inventory sheet as In Production${already}?\n\n` +
            `They become buyable on tilthockey.com straight away, showing an expected date of ${pre.expectedDate}. ` +
            `Each gets a PROD- placeholder where its serial will go.`
        )
      ) {
        return;
      }
      const res = await fetch("/api/inventory/preorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: id }),
      }).then((r) => r.json());
      setListedNote((n) => ({
        ...n,
        [id]: res.ok
          ? `${res.written} listed for pre-order — live on the website.`
          : res.error,
      }));
    } catch (err) {
      setListedNote((n) => ({
        ...n,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setListing(null);
    }
  }

  /**
   * Can the Zoho token actually write to the sheet?
   *
   * Worth knowing BEFORE listing a batch, because the two writes need different
   * scopes and only one of them is exercised by listing. Adding rows is an
   * append; filling a pre-order row in when the stick lands is an UPDATE, and a
   * token missing ZohoSheet.dataAPI.UPDATE will list 212 sticks happily and
   * then fail months later at the shipment. Cheaper to find out now.
   *
   * The probe targets a serial no stick carries, so it matches zero rows and
   * changes nothing.
   */
  async function checkWriteScope() {
    setScope("checking");
    setScopeNote("");
    try {
      const j = await fetch("/api/inventory/write-scope").then((r) => r.json());
      setScope(j.canWrite ? "ok" : "error");
      setScopeNote(j.detail || (j.canWrite ? "Write scope confirmed." : "No write access."));
    } catch (err) {
      setScope("error");
      setScopeNote(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}"? Any sticks already received stay on the inventory sheet.`)) return;
    await fetch(`/api/inventory/production?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    void load();
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-200">In Production</h2>
            <p className="mt-1 text-sm text-gray-500">
              Sticks being built at the factory. Tracked as quantities per spec —
              they have no serial numbers yet — and drawn down automatically when
              the shipment is received.
            </p>
          </div>
          <button
            onClick={() => void checkWriteScope()}
            disabled={scope === "checking"}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 hover:bg-white/[0.05] disabled:opacity-50"
            title="Probe whether the Zoho token can write to the sheet. Changes nothing."
          >
            {scope === "checking" ? "Checking…" : "Check Zoho write access"}
          </button>
        </div>
        {scopeNote && (
          <p
            className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
              scope === "ok"
                ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-300"
                : "border-red-800/60 bg-red-950/30 text-red-300"
            }`}
          >
            {scopeNote}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-800/60 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-6 rounded-xl border border-green-800/60 bg-green-950/30 p-4 text-sm text-green-200">
          {saved}
        </div>
      )}

      {/* Current state */}
      {!preview && (
        <div className="mb-6 space-y-4">
          {batches.filter((b) => !b.closedAt).length === 0 ? (
            <p className="text-sm text-gray-600">Nothing in production right now.</p>
          ) : (
            batches
              .filter((b) => !b.closedAt)
              .map((b) => {
                const ordered = b.lines.reduce((s, l) => s + l.quantity, 0);
                const received = b.lines.reduce((s, l) => s + l.received, 0);
                const pct = ordered > 0 ? Math.round((received / ordered) * 100) : 0;
                return (
                  <div
                    key={b.id}
                    className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-gray-200">{b.label}</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          {ordered} sticks · {b.lines.length} specs · due{" "}
                          <button
                            onClick={() => void changeDate(b.id, b.expectedDate)}
                            className="text-[#00d6ff] underline decoration-dotted underline-offset-2"
                            title="Dates move. Click to update."
                          >
                            {b.expectedDate}
                          </button>
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => void listForPreorder(b.id)}
                          disabled={listing === b.id}
                          className="rounded-lg border border-[#0094b8]/40 bg-[#0094b8]/10 px-3 py-1.5 text-xs font-medium text-[#00d6ff] hover:bg-[#0094b8]/20 disabled:opacity-50"
                          title="Put one row per stick on the inventory sheet so they can be pre-ordered"
                        >
                          {listing === b.id ? "Listing…" : "Sell as pre-order"}
                        </button>
                        <button
                          onClick={() => void remove(b.id, b.label)}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 hover:bg-white/[0.05]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full bg-[#00d6ff]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-gray-600">
                      {received} of {ordered} received
                    </p>
                    {listedNote[b.id] && (
                      <p className="mt-2 text-xs text-[#00d6ff]">{listedNote[b.id]}</p>
                    )}
                  </div>
                );
              })
          )}

          {totalOutstanding > 0 && (
            <details className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5">
              <summary className="cursor-pointer text-sm text-gray-400">
                {totalOutstanding} sticks outstanding across{" "}
                {outstanding.length} specs
              </summary>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {outstanding.map((l, i) => (
                    <tr key={i} className="border-b border-gray-900/60">
                      <td className="py-1.5 text-gray-400">{l.label}</td>
                      <td className="py-1.5 text-right font-mono text-gray-300">
                        {l.outstanding}
                      </td>
                      <td className="py-1.5 pl-4 text-right text-xs text-gray-600">
                        {l.expectedDate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      {/* Upload */}
      {!preview ? (
        <label className="block cursor-pointer rounded-2xl border border-dashed border-gray-700 bg-[#101010]/60 p-8 text-center hover:border-gray-600">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                void upload(f);
              }
            }}
          />
          <p className="text-sm text-gray-300">
            {busy ? "Stockton is reading it…" : "Upload a production list"}
          </p>
          <p className="mt-1 text-xs text-gray-600">
            No serial numbers needed — these sticks don&apos;t have them yet.
          </p>
        </label>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5">
            <p className="text-sm font-semibold text-gray-200">
              {preview.fileName} — {preview.sticksFound} sticks,{" "}
              {preview.lines.length} distinct specs
            </p>
            <p className="mt-2 text-sm text-gray-400">{preview.interpretation}</p>
            {preview.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-amber-300">
                {preview.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            )}
            {preview.excluded.length > 0 && (
              <p className="mt-2 text-xs text-gray-600">
                {preview.excluded.length} rows excluded (custom builds, goalie
                sticks, headings).
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5">
            <p className="text-sm font-semibold text-gray-200">Tell Stockton what to change</p>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              placeholder='e.g. "The 48 inch ones are a separate batch, leave them out"'
              className="mt-2 w-full resize-y rounded-lg border border-gray-800 bg-black/40 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-[#00d6ff]/50 focus:outline-none"
            />
            <button
              onClick={() => file && void upload(file, instructions)}
              disabled={busy || !instructions.trim() || !file}
              className="mt-2 rounded-lg border border-[#0094b8]/40 bg-[#0094b8]/10 px-4 py-2 text-sm font-medium text-[#00d6ff] hover:bg-[#0094b8]/20 disabled:opacity-40"
            >
              {busy ? "Re-reading…" : "Re-read with these notes"}
            </button>
          </div>

          <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs text-gray-500">
                Batch name
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="September factory order"
                  className="rounded-lg border border-gray-800 bg-black/40 px-3 py-2 text-sm text-gray-200 focus:border-[#00d6ff]/50 focus:outline-none"
                />
              </label>
              <label className="grid gap-1 text-xs text-gray-500">
                Expected available
                <input
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                  className="rounded-lg border border-gray-800 bg-black/40 px-3 py-2 text-sm text-gray-200 focus:border-[#00d6ff]/50 focus:outline-none"
                />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {preview.lines.map((l, i) => (
                    <tr key={i} className="border-b border-gray-900/60">
                      <td className="px-4 py-1.5 text-gray-400">{l.label}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-gray-300">
                        ×{l.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setPreview(null);
                setFile(null);
              }}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.05]"
            >
              Start over
            </button>
            <button
              onClick={() => void save()}
              disabled={busy || !label.trim() || !expectedDate}
              className="rounded-lg bg-[#00d6ff] px-5 py-2.5 text-sm font-semibold text-black hover:bg-[#00d6ff]/90 disabled:opacity-50"
              title={!expectedDate ? "Set the expected date first" : undefined}
            >
              {busy
                ? "Saving…"
                : `Track ${preview.lines.reduce((s, l) => s + l.quantity, 0)} sticks in production`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
