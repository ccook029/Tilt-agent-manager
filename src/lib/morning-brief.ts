// ---------------------------------------------------------------------------
// morning-brief.ts — ONE daily email for the whole company (audit item #7)
//
// Replaces the scattered per-agent digest emails as the daily touchpoint:
// every agent's last-24h output, the open questions (with the fill-in answer
// spreadsheet attached), cleanup progress, and any failures — composed in
// Sterling's voice as chief-of-staff for the brief.
// ---------------------------------------------------------------------------
import { callClaude } from "./anthropic";
import { CLAUDE_MODEL } from "./models";
import { sendAnalyticsReport } from "./email";
import { getRunLogs, saveRunLogs } from "./store";
import { getOpenEscalations } from "./policy-ledger";
import { buildQuestionsWorkbook } from "./questions-export";
import { getProgress } from "./progress";
import cfoConfig from "@/agents/accounting-manager.config";

export async function sendMorningBrief(email = true): Promise<{
  body: string;
  openCount: number;
}> {
  const startedAt = new Date();
  const since = startedAt.getTime() - 26 * 3600 * 1000; // 26h window covers cron drift

  const allLogs = await getRunLogs().catch(() => []);
  const logs = allLogs.filter((l) => new Date(l.startedAt).getTime() >= since);
  const failures = logs.filter((l) => l.status === "error");
  const open = await getOpenEscalations().catch(() => []);
  const progress = (await getProgress().catch(() => [])).slice(-7);

  const logsBlock =
    logs.length === 0
      ? "(no agent runs in the last 24 hours)"
      : logs
          .slice(0, 12)
          .map((l) => `### ${l.agentName} — ${l.status}\n${l.output.slice(0, 2200)}`)
          .join("\n\n---\n\n");

  const openBlock =
    open.length === 0
      ? "(none — nothing needs Chris)"
      : open
          .map(
            (e, i) =>
              `${i + 1}. ${e.question}${e.recommendation ? `\n   Recommendation: ${e.recommendation}` : ""}${e.dollarAmount ? `\n   Amount: $${e.dollarAmount}` : ""}`
          )
          .join("\n");

  const progressBlock =
    progress.length === 0
      ? "(no categorization batches recorded yet)"
      : progress
          .map((p) => `${p.at.slice(0, 10)}: ${p.uncategorized} uncategorized remaining (${p.written} written that batch)`)
          .join("\n");

  const res = await callClaude({
    systemPrompt: cfoConfig.systemPrompt,
    userMessage: `Compose the TILT MORNING BRIEF — the ONE email Chris reads each morning covering the whole company's agents. Plain text, skimmable, under 600 words.

Sections, in order:
1. TOP LINE — 3 bullets max across everything (money first).
2. NEEDS YOUR CALL — the numbered open questions with your recommendation on each. If any exist, tell Chris the attached spreadsheet records all his answers at once (fill YOUR ANSWER, upload back in either accounting chat).
3. AGENT REPORTS — one tight paragraph per agent that ran, with the actual numbers. No filler.
4. CLEANUP PROGRESS — the uncategorized-backlog trend in one or two lines.
5. ISSUES — failures and what should happen about them. Omit the section if none.

## Agent runs (last 24h)
${logsBlock}

## Open questions awaiting Chris
${openBlock}

## Cleanup progress
${progressBlock}

## Failures
${failures.length === 0 ? "(none)" : failures.map((f) => `${f.agentName}: ${f.output.slice(0, 300)}`).join("\n")}

Today's date: ${startedAt.toISOString().slice(0, 10)}`,
    model: CLAUDE_MODEL,
    maxTokens: 2048,
    temperature: 0.3,
  });

  if (email) {
    const emailTo =
      process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
      cfoConfig.email.to;
    const wb = open.length > 0 ? await buildQuestionsWorkbook().catch(() => null) : null;
    await sendAnalyticsReport({
      to: emailTo,
      from: "Tilt HQ <agents@tilthockey.com>",
      subject: `Tilt Morning Brief — ${startedAt.toISOString().slice(0, 10)}${open.length > 0 ? ` (${open.length} need your call)` : ""}`,
      reportText: wb
        ? `${res.text}\n\n---\nAttached: ${wb.filename} — fill in YOUR ANSWER and upload it back in either accounting chat to record everything at once.`
        : res.text,
      attachments: wb ? [{ filename: wb.filename, content: wb.buffer }] : undefined,
    });
  }

  await saveRunLogs([
    {
      id: `morning-brief-${startedAt.toISOString()}`,
      agentId: "accounting-manager",
      agentName: "Tilt Morning Brief",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status: "success",
      output: res.text,
      model: CLAUDE_MODEL,
    },
  ]).catch(() => {});

  return { body: res.text, openCount: open.length };
}
