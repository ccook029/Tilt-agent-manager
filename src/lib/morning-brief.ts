// ---------------------------------------------------------------------------
// morning-brief.ts — a daily email, tailored per person.
//
// One data-gathering pass, then a brief composed for each recipient's focus:
//   - accounting (Chris): money-first, the full open-questions queue with the
//     fill-in answer spreadsheet, and the books cleanup trend.
//   - inventory  (Jeremy): stock health, factory reorders and apparel/merch
//     purchasing, and ONLY the questions assigned to him.
//   - all: the everything brief (default / fallback).
//
// Recipients + focus come from MORNING_BRIEF_RECIPIENTS ("email=focus, …").
// With none set it falls back to the single all-focus brief to REPORT_EMAIL_TO
// / EMAIL_TO, i.e. the previous behavior.
// ---------------------------------------------------------------------------
import { callClaude } from "./anthropic";
import { CLAUDE_MODEL } from "./models";
import { sendAnalyticsReport } from "./email";
import { getRunLogs, saveRunLogs } from "./store";
import { getEscalations, type Escalation } from "./policy-ledger";
import { buildQuestionsWorkbook } from "./questions-export";
import { getProgress } from "./progress";
import { getRecentSignals, type Signal } from "./signals";
import { isAccountingOwnerEmail, getStaffByEmail } from "./os-identity";
import { renderOrgKnowledge } from "./org-knowledge";
import cfoConfig from "@/agents/accounting-manager.config";
import inventoryConfig from "@/agents/inventory-agent.config";
import type { AgentRunLog } from "./types";

type Focus = "accounting" | "inventory" | "all";

interface Recipient {
  email: string;
  focus: Focus;
}

function parseRecipients(): Recipient[] {
  const raw = process.env.MORNING_BRIEF_RECIPIENTS?.trim();
  if (raw) {
    const out: Recipient[] = [];
    for (const part of raw.split(",")) {
      const [email, focusRaw] = part.split("=").map((s) => s.trim());
      if (!email) continue;
      const focus = (["accounting", "inventory", "all"].includes(focusRaw)
        ? focusRaw
        : "all") as Focus;
      out.push({ email, focus });
    }
    if (out.length) return out;
  }
  const fallback = (process.env.REPORT_EMAIL_TO ?? process.env.EMAIL_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const emails = fallback.length ? fallback : cfoConfig.email.to;
  return emails.map((email) => ({ email, focus: "all" as Focus }));
}

const isInventoryLog = (l: AgentRunLog) =>
  l.agentId === "inventory" || /inventor|reorder|reconcil|stock/i.test(l.agentName);

const isMerchSignal = (s: Signal) =>
  /stick|catalog|inventor|apparel|merch/i.test(`${s.source} ${s.headline}`);

function renderQuestions(list: Escalation[]): string {
  if (list.length === 0) return "(none)";
  return list
    .map(
      (e, i) =>
        `${i + 1}. ${e.question}${e.recommendation ? `\n   Recommendation: ${e.recommendation}` : ""}${e.dollarAmount ? `\n   Amount: $${e.dollarAmount}` : ""}`
    )
    .join("\n");
}

export async function sendMorningBrief(email = true): Promise<{
  body: string;
  openCount: number;
}> {
  const startedAt = new Date();
  const today = startedAt.toISOString().slice(0, 10);
  const since = startedAt.getTime() - 26 * 3600 * 1000; // 26h covers cron drift

  const allLogs = await getRunLogs().catch(() => []);
  const logs = allLogs.filter((l) => new Date(l.startedAt).getTime() >= since);
  const failures = logs.filter((l) => l.status === "error");
  const allEscalations = await getEscalations().catch((): Escalation[] => []);
  const open = allEscalations.filter((e) => e.status === "open");
  const progress = (await getProgress().catch(() => [])).slice(-7);
  const signals = await getRecentSignals().catch((): Signal[] => []);

  // Shared, focus-neutral blocks.
  const logsBlock =
    logs.length === 0
      ? "(no agent runs in the last 24 hours)"
      : logs
          .slice(0, 12)
          .map((l) => `### ${l.agentName} — ${l.status}\n${l.output.slice(0, 2200)}`)
          .join("\n\n---\n\n");

  const invLogs = logs.filter(isInventoryLog);
  const invLogsBlock =
    invLogs.length === 0
      ? "(no inventory/purchasing agent runs in the last 24 hours)"
      : invLogs
          .map((l) => `### ${l.agentName} — ${l.status}\n${l.output.slice(0, 2400)}`)
          .join("\n\n---\n\n");
  const otherAgentsLine =
    logs.filter((l) => !isInventoryLog(l)).map((l) => `${l.agentName} (${l.status})`).join(", ") ||
    "(none)";

  const signalsAll =
    signals.length === 0
      ? "(none)"
      : signals.map((s) => `- [${s.source}] ${s.headline}${s.detail ? ` — ${s.detail}` : ""}`).join("\n");
  const merchSignals = signals.filter(isMerchSignal);
  const signalsMerch =
    merchSignals.length === 0
      ? "(none)"
      : merchSignals.map((s) => `- [${s.source}] ${s.headline}${s.detail ? ` — ${s.detail}` : ""}`).join("\n");

  const progressBlock =
    progress.length === 0
      ? "(no categorization batches recorded yet)"
      : progress
          .map((p) => `${p.at.slice(0, 10)}: ${p.uncategorized} uncategorized remaining (${p.written} written that batch)`)
          .join("\n");

  const failuresBlock =
    failures.length === 0
      ? "(none)"
      : failures.map((f) => `${f.agentName}: ${f.output.slice(0, 300)}`).join("\n");

  // Compose one brief for a recipient/focus. Questions are scoped to what the
  // recipient is allowed to see.
  const orgKb = await renderOrgKnowledge().catch(() => "");

  async function compose(
    recipient: Recipient,
    name: string
  ): Promise<{ text: string; owner: boolean; questions: Escalation[] }> {
    const owner = isAccountingOwnerEmail(recipient.email);
    // Owners (and the "all"/accounting focus) see the full open queue; anyone
    // else sees only questions assigned to them.
    const questions =
      owner && recipient.focus !== "inventory"
        ? open
        : allEscalations.filter(
            (e) =>
              e.status === "open" &&
              e.assigneeEmail?.toLowerCase() === recipient.email.toLowerCase()
          );

    if (recipient.focus === "inventory") {
      const res = await callClaude({
        systemPrompt: inventoryConfig.systemPrompt + orgKb,
        userMessage: `Compose the TILT INVENTORY & PURCHASING BRIEF for ${name}, who runs inventory and apparel/merch purchasing. Plain text, skimmable, under 500 words. Lead with stock and purchasing; leave out bookkeeping/accounting detail unless it directly affects what to buy.

Sections, in order:
1. TOP LINE — up to 3 bullets: biggest stock risks, reorders/purchases to place now, notable merch/apparel movement.
2. INVENTORY HEALTH — low stock, out-of-stock, and any reconciliation mismatches from Stockton's runs, with the actual numbers.
3. PURCHASING & REORDERS — factory reorder recommendations and apparel/merch purchase commitments: what to order and roughly how much.
4. YOUR QUESTIONS — questions assigned to you to answer (numbered, with the recommendation). Omit the section if none.
5. MERCH & CATALOG SIGNALS — catalog / apparel / stick-sale updates from the tools, one line each. Omit if none.
6. ISSUES — inventory-pipeline failures only. Omit if none.

## Inventory & purchasing agent runs (last 24h)
${invLogsBlock}

## Other agents that ran (context only — do not summarize in detail)
${otherAgentsLine}

## Merch / inventory signals (last 24h)
${signalsMerch}

## Questions assigned to you
${renderQuestions(questions)}

## Inventory-related failures
${failures.filter(isInventoryLog).map((f) => `${f.agentName}: ${f.output.slice(0, 300)}`).join("\n") || "(none)"}

Today's date: ${today}`,
        model: CLAUDE_MODEL,
        maxTokens: 1800,
        temperature: 0.3,
      });
      return { text: res.text, owner, questions };
    }

    // accounting / all
    const res = await callClaude({
      systemPrompt: cfoConfig.systemPrompt + orgKb,
      userMessage: `Compose the TILT MORNING BRIEF for ${name}${recipient.focus === "accounting" ? ", who owns accounting and finance" : ""} — the one email they read each morning covering the company's agents. Plain text, skimmable, under 600 words.${recipient.focus === "accounting" ? " Lead with money, the books cleanup, and decisions needed." : ""}

Sections, in order:
1. TOP LINE — 3 bullets max across everything (money first).
2. NEEDS YOUR CALL — the numbered open questions with the recommendation on each.${owner && questions.length > 0 ? " Tell them the attached spreadsheet records all answers at once (fill YOUR ANSWER, upload back in either accounting chat)." : ""}
3. AGENT REPORTS — one tight paragraph per agent that ran, with the actual numbers. No filler.
4. TOOL SIGNALS — updates pushed by the other Tilt tools (social, web admin, catalog, inventory). One line each; fold material ones into TOP LINE. Omit the section if none.
5. CLEANUP PROGRESS — the uncategorized-backlog trend in one or two lines.
6. ISSUES — failures and what should happen about them. Omit the section if none.

## Agent runs (last 24h)
${logsBlock}

## Signals from Tilt tools (last 24h)
${signalsAll}

## Open questions
${renderQuestions(questions)}

## Cleanup progress
${progressBlock}

## Failures
${failuresBlock}

Today's date: ${today}`,
      model: CLAUDE_MODEL,
      maxTokens: 2048,
      temperature: 0.3,
    });
    return { text: res.text, owner, questions };
  }

  const recipients = parseRecipients();

  // Resolve a friendly name per recipient (from the staff directory, else the
  // email's local part).
  async function nameFor(recipient: Recipient): Promise<string> {
    const profile = await getStaffByEmail(recipient.email).catch(() => null);
    if (profile?.name) return profile.name.split(" ")[0];
    return recipient.email.split("@")[0];
  }

  if (!email) {
    // Compose the first recipient's brief for the return value; don't send.
    const first = recipients[0] ?? { email: "", focus: "all" as Focus };
    const { text } = await compose(first, await nameFor(first));
    return { body: text, openCount: open.length };
  }

  let firstBody = "";
  const sentTo: string[] = [];

  for (const recipient of recipients) {
    const name = await nameFor(recipient);
    let composed;
    try {
      composed = await compose(recipient, name);
    } catch (err) {
      console.error(`[morning-brief] compose failed for ${recipient.email}:`, err);
      continue;
    }
    if (!firstBody) firstBody = composed.text;

    // The answer spreadsheet only goes to the accounting owner.
    const wb =
      composed.owner && composed.questions.length > 0
        ? await buildQuestionsWorkbook().catch(() => null)
        : null;

    const label =
      recipient.focus === "inventory" ? "Inventory & Purchasing Brief" : "Morning Brief";
    const needCall = composed.questions.length;

    try {
      await sendAnalyticsReport({
        to: [recipient.email],
        from: "Tilt HQ <agents@tilthockey.com>",
        subject: `Tilt ${label} — ${today}${needCall > 0 ? ` (${needCall} for you)` : ""}`,
        reportText: wb
          ? `${composed.text}\n\n---\nAttached: ${wb.filename} — fill in YOUR ANSWER and upload it back in either accounting chat to record everything at once.`
          : composed.text,
        attachments: wb ? [{ filename: wb.filename, content: wb.buffer }] : undefined,
      });
      sentTo.push(`${recipient.email} (${recipient.focus})`);
    } catch (err) {
      console.error(`[morning-brief] send failed for ${recipient.email}:`, err);
    }
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
      output:
        `Sent ${sentTo.length} brief(s): ${sentTo.join("; ") || "(none)"}\n\n` +
        firstBody,
      model: CLAUDE_MODEL,
    },
  ]).catch(() => {});

  return { body: firstBody, openCount: open.length };
}
