"use client";

// ---------------------------------------------------------------------------
// /inventory/order-builder — the Stick Order Builder, native in HQ.
//
// "We want to order 200 sticks, skewed heavy senior + lower flex, keep
// variety, include goalies" → a costed, editable factory order. Demand comes
// live from Stockton's Zoho sheet (no export file); steering runs on the
// hub's server-side Claude key; exports produce the Order CSV / Factory PO.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allocate,
  buildDemand,
  channelPrice,
  goalieMsrp,
  goalieUnitCost,
  stockFlag,
  unitCost,
  unitMsrp,
  DEFAULT_CONSTRAINTS,
  LANDED_ADDER,
  CURVES,
  type Channel,
  type CarbonPref,
  type Constraints,
  type GoalieLine,
  type OrderDataset,
  type SpecLine,
} from "@/lib/order-builder/allocator";

interface ChatMsg {
  who: "you" | "tool";
  text: string;
}

const fmt = (n: number) => "$" + n.toLocaleString("en-CA", { maximumFractionDigits: 0 });

const FLAG_CLS: Record<string, string> = {
  risk: "bg-red-950/80 text-red-400",
  hot: "bg-amber-950/80 text-amber-400",
  cover: "bg-emerald-950/60 text-emerald-400",
};

export default function OrderBuilderPage() {
  const [data, setData] = useState<OrderDataset | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [targetQty, setTargetQty] = useState(200);
  const [channel, setChannel] = useState<Channel>("dtc");
  const [carbonPref, setCarbonPref] = useState<CarbonPref>("18K");
  const [constraints, setConstraints] = useState<Constraints>({ ...DEFAULT_CONSTRAINTS });
  const [player, setPlayer] = useState<SpecLine[]>([]);
  const [goalie, setGoalie] = useState<GoalieLine[]>([]);
  const [includeCustom, setIncludeCustom] = useState(true);
  const [chat, setChat] = useState<ChatMsg[]>([
    {
      who: "tool",
      text: 'Tell me how to shape the order. Try: "Skew heavy to senior with lower flex but keep lots of variety, include some goalies" · "Cut junior to 15%, no T02" · "Weight toward stockout risk". I rebuild the recommendation each time.',
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [steering, setSteering] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  // ── data ──
  useEffect(() => {
    fetch("/api/inventory/order-builder/data", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load Stockton data.");
        setData(j as OrderDataset);
      })
      .catch((e) => setDataError(e instanceof Error ? e.message : "Failed to load."));
  }, []);

  const regenerate = useCallback(
    (d: OrderDataset | null, qty: number, carbon: CarbonPref, c: Constraints) => {
      if (!d) return;
      const res = allocate(d, Math.max(10, qty || 200), carbon, c);
      setPlayer(res.player);
      setGoalie(res.goalie);
    },
    []
  );

  useEffect(() => {
    if (data) regenerate(data, targetQty, carbonPref, constraints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [chat]);

  // ── steering ──
  function keywordSteer(text: string): { next: Constraints; changes: string[] } {
    const t = text.toLowerCase();
    const next: Constraints = { ...constraints, curve_exclude: [...constraints.curve_exclude] };
    const changes: string[] = [];
    if (/\bsr\b|senior/.test(t) && /skew|more|weight|heavy|focus/.test(t)) {
      next.level_mix = { Senior: 0.6, Intermediate: 0.25, Junior: 0.15 };
      changes.push("SR-weighted 60/25/15");
    }
    if (/\bjr\b|junior/.test(t) && /skew|more|weight|heavy|focus/.test(t)) {
      next.level_mix = { Senior: 0.15, Intermediate: 0.25, Junior: 0.6 };
      changes.push("JR-weighted");
    }
    if (/lower flex|low flex|whippier/.test(t)) {
      next.flex_bias = "low";
      changes.push("flex biased low");
    }
    if (/higher flex|stiff/.test(t)) {
      next.flex_bias = "high";
      changes.push("flex biased high");
    }
    if (/variety|different|spread|mix it up/.test(t)) {
      next.variety = "high";
      changes.push("variety high");
    }
    if (/concentrate|fewer lines|simple/.test(t)) {
      next.variety = "low";
      changes.push("variety low");
    }
    if (/stockout|thin|risk|running out/.test(t)) {
      next.stock_awareness = 1;
      changes.push("stockout-weighted");
    }
    const goalieMatch = t.match(/goalie[^0-9%]*(\d{1,2})\s*%/);
    if (goalieMatch) {
      next.goalie_share = Math.min(0.3, Number(goalieMatch[1]) / 100);
      changes.push(`goalies ${goalieMatch[1]}%`);
    } else if (/no goalie/.test(t)) {
      next.goalie_share = 0;
      changes.push("no goalies");
    } else if (/goalie/.test(t) && next.goalie_share === 0) {
      next.goalie_share = 0.05;
      changes.push("goalies 5%");
    }
    for (const c of CURVES) {
      if (new RegExp(`no ${c.toLowerCase()}|drop ${c.toLowerCase()}|exclude ${c.toLowerCase()}`).test(t)) {
        next.curve_exclude.push(c);
        changes.push(`excluded ${c}`);
      }
    }
    return { next, changes };
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || steering || !data) return;
    setChatInput("");
    setChat((c) => [...c, { who: "you", text }]);
    setSteering(true);
    try {
      const r = await fetch("/api/inventory/order-builder/steer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          constraints,
          demandByLevel: buildDemand(data).byLevel,
          history: historyRef.current,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Steering failed");
      historyRef.current = [
        ...historyRef.current.slice(-8),
        { role: "user", content: text },
        { role: "assistant", content: j.reply },
      ];
      setConstraints(j.constraints);
      setChat((c) => [...c, { who: "tool", text: j.reply }]);
      regenerate(data, targetQty, carbonPref, j.constraints);
    } catch {
      const { next, changes } = keywordSteer(text);
      setConstraints(next);
      setChat((c) => [
        ...c,
        {
          who: "tool",
          text: changes.length
            ? `Applied (offline keyword mode): ${changes.join(", ")}.`
            : "Steering engine unreachable and keyword mode didn't catch that — try phrases like 'skew SR', 'lower flex', 'more variety', 'no T02', 'goalies 8%'.",
        },
      ]);
      if (changes.length) regenerate(data, targetQty, carbonPref, next);
    } finally {
      setSteering(false);
    }
  }

  // ── committed custom orders (separate section, included in the PO) ──
  const customPlayer = useMemo(() => data?.custom.player ?? [], [data]);
  const customGoalie = useMemo(() => data?.custom.goalie ?? [], [data]);
  const customUnits = useMemo(
    () => customPlayer.reduce((s, l) => s + l.qty, 0) + customGoalie.reduce((s, g) => s + g.qty, 0),
    [customPlayer, customGoalie]
  );

  // ── totals ──
  const totals = useMemo(() => {
    let units = 0,
      cost = 0,
      rev = 0;
    for (const l of player) {
      units += l.qty;
      cost += unitCost(l) * l.qty;
      rev += channelPrice(unitMsrp(l), l.level, channel) * l.qty;
    }
    let gUnits = 0,
      gRev = 0,
      gCost = 0;
    for (const g of goalie) {
      gUnits += g.qty;
      gCost += goalieUnitCost(g.paddle) * g.qty;
      gRev += channelPrice(goalieMsrp(g.paddle), "Goalie", channel) * g.qty;
    }
    let cUnits = 0,
      cCost = 0,
      cRev = 0;
    if (includeCustom) {
      for (const l of customPlayer) {
        cUnits += l.qty;
        cCost += unitCost(l as unknown as SpecLine) * l.qty;
        cRev += channelPrice(unitMsrp(l as unknown as SpecLine), l.level as SpecLine["level"], "dtc") * l.qty;
      }
      for (const g of customGoalie) {
        cUnits += g.qty;
        cCost += goalieUnitCost(g.paddle) * g.qty;
        cRev += channelPrice(goalieMsrp(g.paddle), "Goalie", "dtc") * g.qty;
      }
    }
    const allCost = cost + gCost + cCost;
    const allRev = rev + gRev + cRev;
    return { units, gUnits, cUnits, cost: allCost, rev: allRev, margin: allRev - allCost };
  }, [player, goalie, channel, includeCustom, customPlayer, customGoalie]);

  const mix = useMemo(() => {
    const by: Record<string, number> = { Senior: 0, Intermediate: 0, Junior: 0, Goalie: 0 };
    player.forEach((l) => (by[l.level] += l.qty));
    goalie.forEach((g) => (by.Goalie += g.qty));
    const tot = totals.units + totals.gUnits || 1;
    return { by, tot };
  }, [player, goalie, totals]);

  // ── exports ──
  function download(name: string, text: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = name;
    a.click();
  }
  function logExport(kind: "csv" | "po") {
    void fetch("/api/inventory/order-builder/log-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        units: totals.units + totals.gUnits + totals.cUnits,
        lines: player.length + goalie.length + (includeCustom ? customPlayer.length + customGoalie.length : 0),
        landedCost: totals.cost,
      }),
    }).catch(() => {});
  }
  function exportOrderCSV() {
    const rows: (string | number)[][] = [
      ["Type", "Level", "Length_in", "Carbon", "Kick", "Flex", "Curve", "Base_Color", "Decal_Color", "Hand", "Qty", "Unit_Cost_CAD", "MSRP_CAD", "Channel_Price_CAD", "Line_Cost", "Line_Revenue"],
    ];
    const csvSafe = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    for (const l of player) {
      const uc = unitCost(l),
        mp = unitMsrp(l),
        cp = channelPrice(mp, l.level, channel);
      rows.push(["Player", l.level, l.size, l.carbon, l.kick, l.flex, l.curve, csvSafe(l.baseColor), csvSafe(l.decalColor), l.hand, l.qty, uc, mp, cp.toFixed(2), uc * l.qty, (cp * l.qty).toFixed(2)]);
    }
    for (const g of goalie) {
      const uc = goalieUnitCost(g.paddle),
        mp = goalieMsrp(g.paddle),
        cp = channelPrice(mp, "Goalie", channel);
      rows.push(["Goalie", "Goalie", g.paddle, "18K", "", "", "T31", csvSafe(g.baseColor), csvSafe(g.decalColor), g.hand, g.qty, uc, mp, cp.toFixed(2), uc * g.qty, (cp * g.qty).toFixed(2)]);
    }
    if (includeCustom) {
      for (const l of customPlayer) {
        const sl = l as unknown as SpecLine;
        const uc = unitCost(sl),
          mp = unitMsrp(sl);
        rows.push(["Custom-Player", l.level, l.size, l.carbon, l.kick, l.flex, l.curve, csvSafe(l.baseColor), csvSafe(l.decalColor), l.hand, l.qty, uc, mp, mp.toFixed(2), uc * l.qty, (mp * l.qty).toFixed(2)]);
      }
      for (const g of customGoalie) {
        const uc = goalieUnitCost(g.paddle),
          mp = goalieMsrp(g.paddle);
        rows.push(["Custom-Goalie", "Goalie", g.paddle, "18K", "", "", "T31", csvSafe(g.baseColor), csvSafe(g.decalColor), g.hand, g.qty, uc, mp, mp.toFixed(2), uc * g.qty, (mp * g.qty).toFixed(2)]);
      }
    }
    download("TILT_Order_" + new Date().toISOString().slice(0, 10) + ".csv", rows.map((r) => r.join(",")).join("\n"));
    logExport("csv");
  }
  function exportFactoryPO() {
    const rows: (string | number)[][] = [
      ["Model", "Level", "Length(inch)", "Carbon", "Kick Point", "Flex", "Curve", "Stick Color", "Graphic/Logo", "Hand", "Quantity", "Unit Price (CAD)", "Amount (CAD)"],
    ];
    const csvSafe = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    let tot = 0;
    for (const l of player) {
      const ex = unitCost(l) - LANDED_ADDER;
      tot += ex * l.qty;
      rows.push(["X1", l.level, l.size, l.carbon, l.kick, l.flex, l.curve, csvSafe(l.baseColor), csvSafe(l.decalColor), l.hand, l.qty, ex, ex * l.qty]);
    }
    for (const g of goalie) {
      const ex = goalieUnitCost(g.paddle) - LANDED_ADDER;
      tot += ex * g.qty;
      rows.push(["X1 Goalie", "Goalie", g.paddle, "18K", "", "", "T31", csvSafe(g.baseColor), csvSafe(g.decalColor), g.hand, g.qty, ex, ex * g.qty]);
    }
    let customTotal = 0;
    if (includeCustom) {
      for (const l of customPlayer) {
        const ex = unitCost(l as unknown as SpecLine) - LANDED_ADDER;
        tot += ex * l.qty;
        customTotal += l.qty;
        rows.push(["X1 (CUSTOM)", l.level, l.size, l.carbon, l.kick, l.flex, l.curve, csvSafe(l.baseColor), csvSafe(l.decalColor), l.hand, l.qty, ex, ex * l.qty]);
      }
      for (const g of customGoalie) {
        const ex = goalieUnitCost(g.paddle) - LANDED_ADDER;
        tot += ex * g.qty;
        customTotal += g.qty;
        rows.push(["X1 Goalie (CUSTOM)", "Goalie", g.paddle, "18K", "", "", "T31", csvSafe(g.baseColor), csvSafe(g.decalColor), g.hand, g.qty, ex, ex * g.qty]);
      }
    }
    rows.push(["", "", "", "", "", "", "", "", "", "TOTAL", player.reduce((s, l) => s + l.qty, 0) + goalie.reduce((s, g) => s + g.qty, 0) + customTotal, "", tot]);
    download("TILT_Factory_PO_" + new Date().toISOString().slice(0, 10) + ".csv", rows.map((r) => r.join(",")).join("\n"));
    logExport("po");
  }

  const inputCls =
    "bg-[#181818] border border-gray-800 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-[#00d6ff]/60 font-mono";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase tracking-wide">
            Stick <span className="text-[#00d6ff]">Order Builder</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Stockton-linked factory order recommendations — steer it in plain language.
          </p>
        </div>
        <span
          className={`font-mono text-[11px] px-2.5 py-1 rounded border ${
            data
              ? "border-emerald-700 text-emerald-400"
              : dataError
                ? "border-red-800 text-red-400"
                : "border-gray-700 text-gray-500"
          }`}
        >
          {data
            ? `STOCKTON LIVE · ${data.generated_at.slice(0, 16).replace("T", " ")}`
            : dataError
              ? "DATA ERROR"
              : "LOADING…"}
        </span>
      </div>

      {dataError && (
        <p className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          Couldn&apos;t load Stockton&apos;s sheet: {dataError}
        </p>
      )}
      {data && data.warnings.length > 0 && (
        <details className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-2 text-xs text-amber-300">
          <summary className="cursor-pointer">
            {data.warnings.length} data normalization warning{data.warnings.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1 font-mono">
            {data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-5 items-start">
        {/* ── left rail ── */}
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-800/70 bg-[#111]/60 p-4">
            <h3 className="font-display text-sm uppercase tracking-wide text-white border-b border-[#00d6ff]/50 pb-2 mb-3">
              Order Parameters
            </h3>
            <div className="space-y-2.5">
              <label className="flex items-center gap-2 text-xs text-gray-500 uppercase font-display tracking-wide">
                <span className="w-24 shrink-0">Target Qty</span>
                <input type="number" min={10} step={10} value={targetQty} onChange={(e) => setTargetQty(Number(e.target.value))} className={`${inputCls} flex-1 min-w-0`} />
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-500 uppercase font-display tracking-wide">
                <span className="w-24 shrink-0">Channel</span>
                <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={`${inputCls} flex-1 min-w-0`}>
                  <option value="dtc">DTC (full MSRP)</option>
                  <option value="team">Team (15% off)</option>
                  <option value="wholesale">Wholesale (30% off)</option>
                  <option value="sfs">SFS (SR48/INT43/JR45)</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-500 uppercase font-display tracking-wide">
                <span className="w-24 shrink-0">Carbon</span>
                <select value={carbonPref} onChange={(e) => setCarbonPref(e.target.value as CarbonPref)} className={`${inputCls} flex-1 min-w-0`}>
                  <option value="18K">All 18K</option>
                  <option value="mix">Mix 18K/24K</option>
                  <option value="24K">All 24K</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-500 uppercase font-display tracking-wide">
                <span className="w-24 shrink-0">Goalie %</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={Math.round(constraints.goalie_share * 100)}
                  onChange={(e) => {
                    const next = { ...constraints, goalie_share: Math.min(0.3, Math.max(0, Number(e.target.value) / 100)) };
                    setConstraints(next);
                    regenerate(data, targetQty, carbonPref, next);
                  }}
                  className={`${inputCls} flex-1 min-w-0`}
                />
              </label>
            </div>
            <label className="mt-2.5 flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeCustom}
                onChange={(e) => setIncludeCustom(e.target.checked)}
                className="h-4 w-4 rounded border-gray-700 bg-[#181818] accent-amber-400"
              />
              Include custom order queue ({customUnits} stick{customUnits === 1 ? "" : "s"})
            </label>
            <button
              onClick={() => regenerate(data, targetQty, carbonPref, constraints)}
              disabled={!data}
              className="mt-3 w-full rounded-lg bg-[#00d6ff] px-4 py-2.5 font-display uppercase tracking-wide text-sm font-bold text-[#06232b] hover:bg-[#00a6c9] disabled:opacity-40 transition-colors"
            >
              Generate Recommendation
            </button>
            {/* mix bar */}
            <div className="mt-4">
              <div className="flex h-6 rounded overflow-hidden">
                {(["Senior", "Intermediate", "Junior", "Goalie"] as const).map((l) => {
                  const pct = (mix.by[l] / mix.tot) * 100;
                  const bg = { Senior: "#00d6ff", Intermediate: "#7fdcff", Junior: "#cfeffb", Goalie: "#4caf7d" }[l];
                  return pct > 0 ? (
                    <div key={l} style={{ width: `${pct}%`, background: bg }} className="flex items-center justify-center font-mono text-[10px] font-bold text-[#06232b] overflow-hidden whitespace-nowrap">
                      {Math.round(pct)}%
                    </div>
                  ) : null;
                })}
              </div>
              <div className="flex gap-3 mt-1.5 text-[11px] text-gray-500 font-mono">
                <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#00d6ff" }} />SR</span>
                <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#7fdcff" }} />INT</span>
                <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#cfeffb" }} />JR</span>
                <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#4caf7d" }} />G</span>
              </div>
            </div>
          </div>

          {/* steering console */}
          <div className="rounded-xl border border-gray-800/70 bg-[#111]/60 p-4 flex flex-col">
            <h3 className="font-display text-sm uppercase tracking-wide text-white border-b border-[#00d6ff]/50 pb-2 mb-3">
              Steering Console
            </h3>
            <div ref={chatRef} className="flex flex-col gap-2 overflow-y-auto max-h-72 pr-1">
              {chat.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed max-w-[95%] ${
                    m.who === "you" ? "bg-[#0a4a63] self-end" : "bg-[#1c1c1c] border border-gray-800 self-start"
                  }`}
                >
                  {m.who === "tool" && (
                    <span className="block font-mono text-[10px] text-[#00d6ff] mb-0.5">STOCKTON ADVISOR</span>
                  )}
                  {m.text}
                </div>
              ))}
              {steering && (
                <div className="rounded-lg px-3 py-2 text-[13px] bg-[#1c1c1c] border border-gray-800 self-start text-gray-500">
                  Thinking…
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
                placeholder="Skew heavy SR, lower flex, keep variety, goalies 8%…"
                className={`${inputCls} flex-1 h-14 resize-none`}
              />
              <button
                onClick={() => void sendChat()}
                disabled={steering || !data}
                className="rounded-lg bg-[#00d6ff] px-4 font-display uppercase text-sm font-bold text-[#06232b] hover:bg-[#00a6c9] disabled:opacity-40"
              >
                Send
              </button>
            </div>
            <p className="text-[11px] text-gray-600 mt-2 leading-relaxed">
              Runs on HQ&apos;s server-side Claude — no API key needed. Falls back to keyword parsing if the engine is unreachable.
            </p>
          </div>
        </div>

        {/* ── main ── */}
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
            {[
              [
                "Units",
                String(totals.units + totals.gUnits + totals.cUnits) + (totals.cUnits ? ` (${totals.cUnits} custom)` : ""),
                "",
              ],
              ["Landed Cost (CAD)", fmt(totals.cost), ""],
              ["Revenue @ Channel", fmt(totals.rev), "cy"],
              ["Gross Margin", fmt(totals.margin), "cy"],
              ["Margin %", totals.rev ? Math.round((totals.margin / totals.rev) * 100) + "%" : "0%", ""],
              ["Lines", String(player.length + goalie.length + (includeCustom ? customPlayer.length + customGoalie.length : 0)), ""],
            ].map(([k, v, tone]) => (
              <div key={k} className="rounded-lg border border-gray-800/70 bg-[#111]/60 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-display">{k}</div>
                <div className={`font-mono text-lg font-bold mt-0.5 ${tone === "cy" ? "text-[#00d6ff]" : "text-white"}`}>{v}</div>
              </div>
            ))}
          </div>

          {includeCustom && customPlayer.length + customGoalie.length > 0 && (
            <div className="rounded-xl border border-amber-800/60 overflow-hidden">
              <div className="bg-amber-950/30 px-3 py-2 flex items-center justify-between">
                <span className="font-display uppercase tracking-wide text-xs text-amber-300">
                  Committed Custom Orders — ship with this PO ({totals.cUnits} sticks)
                </span>
                <span className="text-[10px] text-amber-500/80 font-mono">from the admin custom-orders queue</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <tbody>
                    {customPlayer.map((l, i) => (
                      <tr key={`cp${i}`} className="odd:bg-[#191308]/60 even:bg-[#1f180c]/60 border-b border-amber-900/30">
                        <td className="px-2.5 py-1.5">{l.level}</td>
                        <td className="px-2.5 py-1.5">{l.size}&quot;</td>
                        <td className="px-2.5 py-1.5">{l.carbon}</td>
                        <td className="px-2.5 py-1.5">{l.kick}</td>
                        <td className="px-2.5 py-1.5">{l.flex || "—"}</td>
                        <td className="px-2.5 py-1.5">{l.curve || "—"}</td>
                        <td className="px-2.5 py-1.5 max-w-[160px] truncate" title={`${l.baseColor} / ${l.decalColor}`}>
                          {l.baseColor || "—"} / {l.decalColor || "—"}
                        </td>
                        <td className="px-2.5 py-1.5">{l.hand[0]}</td>
                        <td className="px-2.5 py-1.5 text-amber-300">{l.qty}</td>
                        <td className="px-2.5 py-1.5">{fmt(unitCost(l as unknown as SpecLine))}</td>
                        <td className="px-2.5 py-1.5" colSpan={3}>
                          <span className="text-amber-500/80 text-[10px] uppercase">Custom</span>
                        </td>
                      </tr>
                    ))}
                    {customGoalie.map((g, i) => (
                      <tr key={`cg${i}`} className="odd:bg-[#191308]/60 even:bg-[#1f180c]/60 border-b border-amber-900/30">
                        <td className="px-2.5 py-1.5">Goalie</td>
                        <td className="px-2.5 py-1.5">{g.paddle}&quot; paddle</td>
                        <td className="px-2.5 py-1.5 text-gray-600" colSpan={4}>—</td>
                        <td className="px-2.5 py-1.5 max-w-[160px] truncate">{g.baseColor || "—"} / {g.decalColor || "—"}</td>
                        <td className="px-2.5 py-1.5">{g.hand[0]}</td>
                        <td className="px-2.5 py-1.5 text-amber-300">{g.qty}</td>
                        <td className="px-2.5 py-1.5">{fmt(goalieUnitCost(g.paddle))}</td>
                        <td className="px-2.5 py-1.5" colSpan={3}>
                          <span className="text-amber-500/80 text-[10px] uppercase">Custom</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-800/70 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="bg-black text-left">
                    {["Level", "Len", "Carbon", "Kick", "Flex", "Curve", "Colors (base / decal)", "Hand", "Qty", "Unit Cost", "MSRP", "Stock", ""].map((h) => (
                      <th key={h} className="px-2.5 py-2 font-display uppercase tracking-wide text-[11px] border-b-2 border-[#00d6ff]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {player.map((l, idx) => {
                    const stock = stockFlag(
                      data ?? { player: { inventory: [], lifetime_orders: [] }, goalie: { inventory: [], lifetime_orders: [] }, custom: { player: [], goalie: [] }, generated_at: "", source: "", warnings: [] },
                      l.level,
                      l.size,
                      { flex: l.flex, curve: l.curve, hand: l.hand }
                    );
                    return (
                      <tr key={idx} className="odd:bg-[#111]/60 even:bg-[#161616]/60 border-b border-gray-800/50">
                        <td className="px-2.5 py-1.5">{l.level}</td>
                        <td className="px-2.5 py-1.5">{l.size}&quot;</td>
                        <td className="px-2.5 py-1.5">{l.carbon}</td>
                        <td className="px-2.5 py-1.5">{l.kick}</td>
                        <td className="px-2.5 py-1.5">{l.flex}</td>
                        <td className="px-2.5 py-1.5">{l.curve}</td>
                        <td className="px-2.5 py-1.5 max-w-[160px] truncate" title={`${l.baseColor} / ${l.decalColor}`}>
                          {l.baseColor || "—"} / {l.decalColor || "—"}
                        </td>
                        <td className="px-2.5 py-1.5">{l.hand[0]}</td>
                        <td className="px-2.5 py-1.5">
                          <input
                            type="number"
                            min={0}
                            value={l.qty}
                            onChange={(e) => {
                              const next = [...player];
                              next[idx] = { ...l, qty: Number(e.target.value) };
                              setPlayer(next.filter((x) => x.qty > 0));
                            }}
                            className="w-16 bg-[#181818] border border-gray-800 rounded px-1.5 py-1 text-right"
                          />
                        </td>
                        <td className="px-2.5 py-1.5">{fmt(unitCost(l))}</td>
                        <td className="px-2.5 py-1.5">{fmt(unitMsrp(l))}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          <span
                            title={stock.explain}
                            className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] cursor-help ${FLAG_CLS[stock.tone]}`}
                          >
                            {stock.exact} exact · {stock.available} @ {l.size}&quot;
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5">
                          <button onClick={() => setPlayer(player.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-300">
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {goalie.map((g, idx) => (
                    <tr key={`g${idx}`} className="odd:bg-[#0d1a12]/70 even:bg-[#0f1f15]/70 border-b border-gray-800/50">
                      <td className="px-2.5 py-1.5 text-emerald-400">Goalie</td>
                      <td className="px-2.5 py-1.5">{g.paddle}&quot; paddle</td>
                      <td className="px-2.5 py-1.5 text-gray-600" colSpan={4}>
                        —
                      </td>
                      <td className="px-2.5 py-1.5 max-w-[160px] truncate" title={`${g.baseColor} / ${g.decalColor}`}>
                        {g.baseColor || "—"} / {g.decalColor || "—"}
                      </td>
                      <td className="px-2.5 py-1.5">{g.hand[0]}</td>
                      <td className="px-2.5 py-1.5">
                        <input
                          type="number"
                          min={0}
                          value={g.qty}
                          onChange={(e) => {
                            const next = [...goalie];
                            next[idx] = { ...g, qty: Number(e.target.value) };
                            setGoalie(next.filter((x) => x.qty > 0));
                          }}
                          className="w-16 bg-[#181818] border border-gray-800 rounded px-1.5 py-1 text-right"
                        />
                      </td>
                      <td className="px-2.5 py-1.5">{fmt(goalieUnitCost(g.paddle))}</td>
                      <td className="px-2.5 py-1.5">{fmt(goalieMsrp(g.paddle))}</td>
                      <td className="px-2.5 py-1.5" colSpan={2} />
                    </tr>
                  ))}
                  {player.length + goalie.length === 0 && (
                    <tr>
                      <td colSpan={13} className="px-3 py-10 text-center text-gray-600">
                        {data ? "Set a target quantity and hit Generate." : "Waiting for Stockton data…"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-gray-500 leading-relaxed -mt-1">
            <span className="font-display uppercase tracking-wide text-gray-400">Stock</span> = &quot;N exact&quot; is sticks on hand matching that
            row&apos;s exact flex/curve/hand; the second number is everything on hand at that level + length. Color is the health vs how fast
            that length sells:{" "}
            <span className={`px-1 py-0.5 rounded text-[10px] font-mono whitespace-nowrap ${FLAG_CLS.risk}`}>red</span> none left ·{" "}
            <span className={`px-1 py-0.5 rounded text-[10px] font-mono whitespace-nowrap ${FLAG_CLS.hot}`}>amber</span> running thin ·{" "}
            <span className={`px-1 py-0.5 rounded text-[10px] font-mono whitespace-nowrap ${FLAG_CLS.cover}`}>green</span> healthy. Hover any
            badge for the exact comparison (on hand vs lifetime ordered).
          </p>

          <div className="flex flex-wrap gap-2.5">
            <button onClick={exportOrderCSV} disabled={!player.length} className="rounded-lg bg-[#00d6ff] px-3.5 py-2 font-display uppercase text-xs font-bold text-[#06232b] hover:bg-[#00a6c9] disabled:opacity-40">
              ⬇ Order CSV
            </button>
            <button onClick={exportFactoryPO} disabled={!player.length} className="rounded-lg bg-[#00d6ff] px-3.5 py-2 font-display uppercase text-xs font-bold text-[#06232b] hover:bg-[#00a6c9] disabled:opacity-40">
              ⬇ Factory PO (Huizhou format)
            </button>
            <button
              onClick={() => setPlayer([...player, { level: "Senior", size: 66, carbon: "18K", kick: "Mid", hand: "Left", flex: 85, curve: "T92", baseColor: "Black", decalColor: "White", qty: 1 }])}
              className="rounded-lg border border-[#00d6ff]/60 px-3.5 py-2 font-display uppercase text-xs font-bold text-[#00d6ff] hover:bg-[#00d6ff]/10"
            >
              + Add Line
            </button>
            <button onClick={() => regenerate(data, targetQty, carbonPref, constraints)} className="rounded-lg border border-[#00d6ff]/60 px-3.5 py-2 font-display uppercase text-xs font-bold text-[#00d6ff] hover:bg-[#00d6ff]/10">
              ↺ Regenerate
            </button>
          </div>

          <p className="text-[11px] text-gray-600 font-mono leading-relaxed border-t border-gray-800/70 pt-3">
            COGS (factory CAD + ${LANDED_ADDER} air landed): JR 48–52&quot; $53 · JR 54&quot;+ $58 · INT/SR $85 (24K premium applied) · goalie
            per paddle from the Huizhou PI ($122–$132). Channel pricing: DTC=MSRP, Team=-15%, Wholesale=-30%, SFS=SR-48/INT-43/JR-45 (goalie
            at SR tier). Edit economics in <span className="text-gray-500">src/lib/order-builder/allocator.ts</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
