"use client";

// ---------------------------------------------------------------------------
// /inventory/intake — drop a received-stock spreadsheet, Stockton reads it.
//
// Preview first, always. The Player tab is what the website sells from, so
// what Stockton understood is on screen before anything is written, with
// every excluded row and its reason visible rather than silently dropped.
// ---------------------------------------------------------------------------
import { useState } from "react";

interface IntakeRow {
  sourceRow: number;
  level: string;
  size: string;
  carbon: string;
  kickPoint: string;
  hand: string;
  flex: string;
  curve: string;
  baseColor: string;
  decalColor: string;
  serial: string;
  excludeReason?: string;
  notes?: string;
}

interface Preview {
  fileName: string;
  rowsInFile: number;
  interpretation: string;
  warnings: string[];
  rows: IntakeRow[];
}

export default function IntakePage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; skipped: { serial: string; reason: string }[] } | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setPreview(null);
    setDropped(new Set());
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/inventory/intake", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Could not read that file");
      setPreview(j as Preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  }

  const included = (preview?.rows ?? []).filter(
    (r) => !r.excludeReason && !dropped.has(r.sourceRow)
  );
  const excluded = (preview?.rows ?? []).filter((r) => r.excludeReason);

  async function commit() {
    if (included.length === 0) return;
    if (
      !confirm(
        `Add ${included.length} sticks to the inventory sheet as Available?\n\nThey go live on the website immediately.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: included }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Write failed");
      setResult({ added: j.added, skipped: j.skipped ?? [] });
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Write failed");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (row: number) =>
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-200">Receive Stock</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload the count sheet as it is. Stockton works out the columns, skips
          custom builds, goalie sticks and separators, and shows you what he
          understood before anything is written.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-800/60 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mb-6 rounded-xl border border-green-800/60 bg-green-950/30 p-4 text-sm text-green-200">
          <p className="font-semibold">
            {result.added} sticks added to the inventory sheet as Available.
          </p>
          {result.skipped.length > 0 && (
            <p className="mt-1 text-xs text-green-200/80">
              {result.skipped.length} skipped as already present:{" "}
              {result.skipped.map((s) => s.serial).join(", ")}
            </p>
          )}
        </div>
      )}

      {!preview && (
        <label className="block cursor-pointer rounded-2xl border border-dashed border-gray-700 bg-[#101010]/60 p-10 text-center hover:border-gray-600">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <p className="text-sm text-gray-300">
            {busy ? "Stockton is reading it…" : "Choose a spreadsheet (.xlsx or .csv)"}
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Merged headers, box separators and a custom-order section are all fine.
          </p>
        </label>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5">
            <p className="text-sm font-semibold text-gray-200">
              {preview.fileName} — {preview.rowsInFile} rows read
            </p>
            <p className="mt-2 text-sm text-gray-400">{preview.interpretation}</p>
            {preview.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-amber-300">
                {preview.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm">
              <span className="text-[#00d6ff]">{included.length} going in</span>
              <span className="text-gray-600"> · {excluded.length} excluded</span>
            </p>
          </div>

          <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 overflow-hidden">
            <div className="max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#101010]">
                  <tr className="border-b border-gray-800/80 text-left text-xs uppercase tracking-wide text-gray-600">
                    <th className="px-3 py-2">In</th>
                    <th className="px-3 py-2">Serial</th>
                    <th className="px-3 py-2">Level</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Flex</th>
                    <th className="px-3 py-2">Curve</th>
                    <th className="px-3 py-2">Hand</th>
                    <th className="px-3 py-2">Colors</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows
                    .filter((r) => !r.excludeReason)
                    .map((r) => (
                      <tr key={r.sourceRow} className="border-b border-gray-900/60">
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={!dropped.has(r.sourceRow)}
                            onChange={() => toggle(r.sourceRow)}
                          />
                        </td>
                        <td className="px-3 py-1.5 font-mono text-gray-300">{r.serial}</td>
                        <td className={`px-3 py-1.5 ${r.level ? "text-gray-400" : "text-amber-400"}`}>
                          {r.level || "—"}
                        </td>
                        <td className="px-3 py-1.5 text-gray-400">{r.size}</td>
                        <td className="px-3 py-1.5 text-gray-400">{r.flex}</td>
                        <td className="px-3 py-1.5 text-gray-400">{r.curve}</td>
                        <td className="px-3 py-1.5 text-gray-400">{r.hand}</td>
                        <td className="px-3 py-1.5 text-gray-600">
                          {r.baseColor} / {r.decalColor}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {excluded.length > 0 && (
              <>
                <button
                  onClick={() => setShowExcluded(!showExcluded)}
                  className="w-full border-t border-gray-800/80 px-5 py-2.5 text-left text-xs text-gray-500 hover:text-gray-300"
                >
                  {showExcluded ? "Hide" : "Show"} the {excluded.length} excluded rows
                </button>
                {showExcluded && (
                  <div className="max-h-72 overflow-y-auto border-t border-gray-900/60">
                    <table className="w-full text-sm">
                      <tbody>
                        {excluded.map((r) => (
                          <tr key={r.sourceRow} className="border-b border-gray-900/60">
                            <td className="px-3 py-1.5 text-gray-600">row {r.sourceRow}</td>
                            <td className="px-3 py-1.5 font-mono text-gray-500">
                              {r.serial || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-amber-400/80">{r.excludeReason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setPreview(null)}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.05]"
            >
              Start over
            </button>
            <button
              onClick={() => void commit()}
              disabled={busy || included.length === 0}
              className="rounded-lg bg-[#00d6ff] px-5 py-2.5 text-sm font-semibold text-black hover:bg-[#00d6ff]/90 disabled:opacity-50"
            >
              {busy ? "Adding…" : `Add ${included.length} sticks to inventory`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
