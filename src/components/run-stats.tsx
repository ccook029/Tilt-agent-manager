"use client";

// ---------------------------------------------------------------------------
// RunStats — turns an agent's run history into a glanceable panel:
// success-rate ring, totals, and a duration sparkline.
// ---------------------------------------------------------------------------
import { Ring, Sparkline } from "@/components/charts";

interface RunLog {
  id: string;
  status: "success" | "error";
  durationMs: number;
  tokensUsed?: number;
  startedAt: string;
}

export default function RunStats({ logs }: { logs: RunLog[] }) {
  if (logs.length === 0) return null;

  const total = logs.length;
  const successes = logs.filter((l) => l.status === "success").length;
  const successRate = (successes / total) * 100;
  const avgMs = logs.reduce((s, l) => s + l.durationMs, 0) / total;
  const totalTokens = logs.reduce((s, l) => s + (l.tokensUsed ?? 0), 0);

  // Oldest → newest durations (seconds) for the sparkline.
  const durations = [...logs]
    .sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt))
    .slice(-16)
    .map((l) => l.durationMs / 1000);

  const stat = (label: string, value: string) => (
    <div>
      <p className="font-display text-2xl font-bold tabular-nums text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
    </div>
  );

  return (
    <div className="mb-6 rounded-xl border border-gray-800/60 bg-[#111]/40 p-5">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <Ring percent={successRate} label="Success" />
        <div className="grid flex-1 grid-cols-3 gap-4">
          {stat("Runs", String(total))}
          {stat("Avg Time", `${(avgMs / 1000).toFixed(1)}s`)}
          {stat(
            "Tokens",
            totalTokens >= 1000
              ? `${(totalTokens / 1000).toFixed(1)}k`
              : String(totalTokens)
          )}
        </div>
        <div className="min-w-0 flex-1 sm:max-w-[240px]">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
            Run duration
          </p>
          <Sparkline values={durations} />
        </div>
      </div>
    </div>
  );
}
