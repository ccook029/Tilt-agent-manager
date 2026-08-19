"use client";

// ---------------------------------------------------------------------------
// /inventory/serial-audit — a physical count, checked against the live sheet.
//
// Paste the serials (or drop the register file), and this comes back with the
// specs of every stick you counted plus the three ways a count and a sheet can
// disagree. The download is the same thing as a workbook.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { serialsFromGrid, type CountedSerial } from "@/lib/serial-audit";
import { SERIAL_COUNT_2026_08, COUNT_DATE } from "@/data/serial-count-2026-08";

interface MatchedRow {
  serial: string;
  batchMonth: string;
  level: string;
  size: number;
  carbon: string;
  kickPoint: string;
  hand: string;
  flex: number;
  curve: string;
  baseColor: string;
  decalColor: string;
  status: string;
  dateSold: string;
  tab: string;
  note: string;
}

interface AuditResponse {
  ok: boolean;
  error?: string;
  sheetRows?: number;
  summary?: {
    counted: number;
    matched: number;
    notOnSheet: number;
    soldButPresent: number;
    missingFromCount: number;
    skippedNotYetBuilt: number;
  };
  matched?: MatchedRow[];
  notOnSheet?: { serial: string; batchMonth: string; format: string; note: string }[];
  soldButPresent?: { serial: string; dateSold: string; level: string; curve: string }[];
  missingFromCount?: {
    serial: string; status: string; level: string; size: number;
    carbon: string; curve: string; flex: number; tab: string;
  }[];
  duplicatesInCount?: string[];
}

function toText(list: CountedSerial[]): string {
  return list.map((c) => (c.note ? `${c.serial}, ${c.note}` : c.serial)).join("\n");
}

export default function SerialAuditPage() {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [downloading, setDownloading] = useState(false);

  const serialCount = text.split(/\r?\n/).filter((l) => l.trim()).length;

  async function onFile(file: File) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    // Every tab, because a register often keeps its summary on sheet 1 and the
    // serials on sheet 2.
    for (const name of wb.SheetNames) {
      const grid = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[name], {
        header: 1,
        raw: false,
      });
      const found = serialsFromGrid(grid);
      if (found.length > 0) {
        setText(toText(found));
        return;
      }
    }
    setResult({ ok: false, error: `No serials found in ${file.name}.` });
  }

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/inventory/serial-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serials: text }),
      });
      setResult(await res.json());
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Failed" });
    } finally {
      setRunning(false);
    }
  }

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch("/api/inventory/serial-audit?format=xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serials: text }),
      });
      if (!res.ok) {
        setResult(await res.json());
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tilt-serial-audit-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const s = result?.summary;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-200">Serial Audit</h2>
        <p className="mt-1 text-sm text-gray-500">
          Paste the serials you counted. This looks every one of them up on the
          master sheet, hands back the specs, and says what the count and the
          sheet disagree about.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={"H2607-09684\nH2607-09685\nH202604-05359, photo blur"}
          className="w-full rounded-lg border border-gray-800 bg-[#0c0c0c] p-3 font-mono text-sm text-gray-200 outline-none focus:border-[#00d6ff]/50"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={running || serialCount === 0}
            className="rounded-lg bg-[#0094b8] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {running ? "Checking…" : `Check ${serialCount || ""} serial${serialCount === 1 ? "" : "s"}`}
          </button>

          <label className="cursor-pointer rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-[#00d6ff]/50">
            Upload a count sheet
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>

          <button
            onClick={() => setText(toText(SERIAL_COUNT_2026_08))}
            className="text-xs text-gray-500 hover:text-[#00d6ff]"
          >
            Load the {COUNT_DATE} count ({SERIAL_COUNT_2026_08.length} sticks)
          </button>

          {result?.ok && (
            <button
              onClick={download}
              disabled={downloading}
              className="ml-auto rounded-lg border border-[#00d6ff]/40 px-3 py-2 text-sm text-[#00d6ff] disabled:opacity-40"
            >
              {downloading ? "Building…" : "Download spreadsheet"}
            </button>
          )}
        </div>
      </div>

      {result && !result.ok && (
        <p className="mt-4 rounded-xl border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-300">
          {result.error ?? "Something went wrong."}
        </p>
      )}

      {s && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label="Counted" value={s.counted} />
            <Tile label="Found on sheet" value={s.matched} good />
            <Tile label="Not on sheet" value={s.notOnSheet} bad={s.notOnSheet > 0} />
            <Tile label="Missing from count" value={s.missingFromCount} bad={s.missingFromCount > 0} />
            <Tile label="Sold but present" value={s.soldButPresent} bad={s.soldButPresent > 0} />
          </div>

          <p className="text-xs text-gray-600">
            Checked against {result?.sheetRows ?? 0} sheet rows.{" "}
            {s.skippedNotYetBuilt > 0 && (
              <>
                {s.skippedNotYetBuilt} row{s.skippedNotYetBuilt === 1 ? "" : "s"} left
                out — still in production, so the floor can&apos;t contradict them.
              </>
            )}
          </p>

          {result?.duplicatesInCount && result.duplicatesInCount.length > 0 && (
            <p className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-sm text-amber-300">
              Counted twice: {result.duplicatesInCount.join(", ")}
            </p>
          )}

          {result?.notOnSheet && result.notOnSheet.length > 0 && (
            <Section
              title="Counted, but not on the sheet"
              tone="bad"
              blurb="Real sticks with no row. Nothing lists them, so nobody can buy them."
            >
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-600">
                  <tr><th className="py-1">Serial</th><th>Batch</th><th>Note</th></tr>
                </thead>
                <tbody>
                  {result.notOnSheet.map((n) => (
                    <tr key={n.serial} className="border-t border-gray-900">
                      <td className="py-1.5 font-mono text-gray-200">{n.serial}</td>
                      <td className="text-gray-500">{n.batchMonth || n.format}</td>
                      <td className="text-gray-600">{n.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {result?.missingFromCount && result.missingFromCount.length > 0 && (
            <Section
              title="On the sheet, not counted"
              tone="bad"
              blurb="Listed as on hand but not found. Each of these can be ordered today."
            >
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-600">
                  <tr>
                    <th className="py-1">Serial</th><th>Status</th><th>Level</th>
                    <th>Size</th><th>Curve</th><th>Flex</th>
                  </tr>
                </thead>
                <tbody>
                  {result.missingFromCount.map((m) => (
                    <tr key={m.serial} className="border-t border-gray-900">
                      <td className="py-1.5 font-mono text-gray-200">{m.serial}</td>
                      <td className="text-gray-500">{m.status}</td>
                      <td className="text-gray-500">{m.level}</td>
                      <td className="text-gray-500">{m.size}</td>
                      <td className="text-gray-500">{m.curve}</td>
                      <td className="text-gray-500">{m.flex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {result?.soldButPresent && result.soldButPresent.length > 0 && (
            <Section
              title="Sold, but still here"
              tone="warn"
              blurb="Either it hasn't shipped, or the sale was recorded against the wrong stick."
            >
              <ul className="space-y-1 text-sm">
                {result.soldButPresent.map((m) => (
                  <li key={m.serial} className="text-gray-300">
                    <span className="font-mono">{m.serial}</span>
                    <span className="text-gray-600"> — sold {m.dateSold || "date unknown"}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {result?.matched && result.matched.length > 0 && (
            <Section title={`Specs — ${result.matched.length} sticks`} tone="ok">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-gray-600">
                    <tr>
                      <th className="py-1 pr-3">Serial</th><th className="pr-3">Level</th>
                      <th className="pr-3">Size</th><th className="pr-3">Carbon</th>
                      <th className="pr-3">Kick</th><th className="pr-3">Hand</th>
                      <th className="pr-3">Flex</th><th className="pr-3">Curve</th>
                      <th className="pr-3">Base</th><th className="pr-3">Decal</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.matched.map((m) => (
                      <tr key={m.serial} className="border-t border-gray-900">
                        <td className="py-1.5 pr-3 font-mono text-gray-200">{m.serial}</td>
                        <td className="pr-3 text-gray-400">{m.level}</td>
                        <td className="pr-3 text-gray-400">{m.size}</td>
                        <td className="pr-3 text-gray-400">{m.carbon}</td>
                        <td className="pr-3 text-gray-400">{m.kickPoint}</td>
                        <td className="pr-3 text-gray-400">{m.hand}</td>
                        <td className="pr-3 text-gray-400">{m.flex}</td>
                        <td className="pr-3 text-gray-400">{m.curve}</td>
                        <td className="pr-3 text-gray-400">{m.baseColor}</td>
                        <td className="pr-3 text-gray-400">{m.decalColor}</td>
                        <td className="text-gray-500">{m.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({
  label, value, good, bad,
}: { label: string; value: number; good?: boolean; bad?: boolean }) {
  const tone = bad ? "text-red-300" : good ? "text-[#00d6ff]" : "text-gray-200";
  return (
    <div className="rounded-xl border border-gray-800/80 bg-[#101010]/80 p-3">
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-gray-600">{label}</div>
    </div>
  );
}

function Section({
  title, blurb, tone, children,
}: {
  title: string;
  blurb?: string;
  tone: "ok" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const border =
    tone === "bad" ? "border-red-900/50" : tone === "warn" ? "border-amber-900/50" : "border-gray-800/80";
  return (
    <div className={`rounded-2xl border ${border} bg-[#101010]/80 p-4`}>
      <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      {blurb && <p className="mt-0.5 mb-3 text-xs text-gray-600">{blurb}</p>}
      {children}
    </div>
  );
}
