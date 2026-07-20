// ---------------------------------------------------------------------------
// daily-brief.ts — the on-dashboard Daily Brief: what's pressing and what
// every employee has been up to, at a glance.
//
// Unlike the morning-brief email (a per-recipient composed letter), this is a
// structured object rendered as a panel at the top of HQ. Generated at most
// once per day (lazily, on the first dashboard visit) and cached in KV; the
// Refresh button regenerates on demand.
//
// Sources (last ~26h): agent run logs, cross-tool signals, open escalations
// ("needs your call"), and the accounting action log. The model attributes
// activity to each org-directory employee and must produce one line per
// employee — including "quiet" ones — so the panel reads like a standup.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import { callClaude } from "./anthropic";
import { CLAUDE_MODEL } from "./models";
import { getRunLogs } from "./store";
import { getRecentSignals, type Signal } from "./signals";
import { getEscalations, type Escalation } from "./policy-ledger";
import { getRecentActions, type AccountingAction } from "./action-log";
import { getEmployees } from "./org/directory";
import { getPersonaByAgentId } from "./personas";
import type { AgentRunLog } from "./types";

const KEY = "daily-brief";

export interface PressingItem {
  text: string;
  /** Optional in-app destination, restricted to LINK_CHOICES. */
  link?: string;
}

export interface EmployeeLine {
  id: string;
  name: string;
  title: string;
  initials: string;
  color: string;
  accent: string;
  href: string;
  /** One standup-style sentence on their last 24h. */
  line: string;
  status: "active" | "quiet" | "issue";
}

export interface DailyBrief {
  /** YYYY-MM-DD the brief covers (generation day). */
  date: string;
  generatedAt: string;
  /** One-sentence read on the whole business today. */
  topline: string;
  pressing: PressingItem[];
  employees: EmployeeLine[];
}

const LINK_CHOICES = [
  "/review",
  "/questions",
  "/inventory/order-builder",
  "/staff",
  "/strategy",
  "/knowledge",
];

function rosterEntry(e: { id: string; name: string; title: string; personaId?: string }) {
  const persona = e.personaId ? getPersonaByAgentId(e.personaId) : undefined;
  return {
    id: e.id,
    name: e.name,
    title: e.title,
    initials:
      persona?.avatarInitials ??
      e.name.split(" ").map((n) => n[0]).join("").slice(0, 2),
    color: persona?.avatarColor ?? "bg-gray-700",
    accent: persona?.avatarAccent ?? "ring-gray-500",
    href: `/org/${e.id}`,
    personaId: e.personaId,
  };
}

/** Pull the first JSON object out of a model reply (tolerates code fences). */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Deterministic fallback so the panel still renders if the model call fails. */
function fallbackBrief(
  today: string,
  roster: ReturnType<typeof rosterEntry>[],
  logs: AgentRunLog[],
  signals: Signal[],
  open: Escalation[]
): DailyBrief {
  const failures = logs.filter((l) => l.status === "error");
  const pressing: PressingItem[] = [];
  if (open.length > 0) {
    pressing.push({
      text: `${open.length} question${open.length === 1 ? "" : "s"} waiting on your call.`,
      link: "/questions",
    });
  }
  if (failures.length > 0) {
    pressing.push({
      text: `${failures.length} agent run${failures.length === 1 ? "" : "s"} failed in the last 24h.`,
      link: "/review",
    });
  }
  const employees: EmployeeLine[] = roster.map((r) => {
    const runs = logs.filter((l) => l.agentId === r.personaId);
    const failed = runs.some((l) => l.status === "error");
    const line =
      runs.length > 0
        ? `${runs.length} run${runs.length === 1 ? "" : "s"} in the last 24h${failed ? " (one failed)" : ""}.`
        : "Quiet — no runs in the last 24h.";
    return {
      id: r.id,
      name: r.name,
      title: r.title,
      initials: r.initials,
      color: r.color,
      accent: r.accent,
      href: r.href,
      line,
      status: failed ? "issue" : runs.length > 0 ? "active" : "quiet",
    };
  });
  return {
    date: today,
    generatedAt: new Date().toISOString(),
    topline: `${logs.length} agent runs and ${signals.length} tool signals in the last 24 hours.`,
    pressing,
    employees,
  };
}

async function generate(today: string): Promise<DailyBrief> {
  const since = Date.now() - 26 * 3600_000;
  const [allLogs, signals, escalations, actions] = await Promise.all([
    getRunLogs().catch((): AgentRunLog[] => []),
    getRecentSignals().catch((): Signal[] => []),
    getEscalations().catch((): Escalation[] => []),
    getRecentActions(40).catch((): AccountingAction[] => []),
  ]);
  const logs = allLogs.filter((l) => new Date(l.startedAt).getTime() >= since);
  const open = escalations.filter((e) => e.status === "open");
  const roster = getEmployees()
    .filter((e) => e.enabled)
    .map(rosterEntry);

  const logsBlock =
    logs.length === 0
      ? "(no agent runs in the last 24 hours)"
      : logs
          .slice(0, 16)
          .map(
            (l) =>
              `### ${l.agentName} (agentId: ${l.agentId}) — ${l.status}\n${l.output.slice(0, 1200)}`
          )
          .join("\n\n---\n\n");
  const signalsBlock =
    signals.length === 0
      ? "(none)"
      : signals
          .map((s) => `- [${s.source}] ${s.headline}${s.detail ? ` — ${s.detail}` : ""}`)
          .join("\n");
  const questionsBlock =
    open.length === 0
      ? "(none)"
      : open
          .slice(0, 10)
          .map((e) => `- ${e.question}${e.dollarAmount ? ` ($${e.dollarAmount})` : ""}`)
          .join("\n");
  // Only same-day actions matter for the brief; the log itself keeps 100s.
  const recentActions = actions.filter(
    (a) => new Date(a.timestamp).getTime() >= since
  );
  const actionsBlock =
    recentActions.length === 0
      ? "(none)"
      : recentActions
          .slice(0, 15)
          .map((a) => `- [${a.mode}] ${a.summary}`)
          .join("\n");
  const rosterBlock = roster
    .map((r) => `- id "${r.id}": ${r.name} — ${r.title}${r.personaId ? ` (agentId: ${r.personaId})` : ""}`)
    .join("\n");

  const prompt = `You write the DAILY BRIEF panel at the top of Tilt Hockey's internal HQ dashboard — the owner's at-a-glance read on the whole business each morning.

Return STRICT JSON only (no prose, no code fences) with exactly this shape:
{
  "topline": "one sentence, the single most useful read on the business today",
  "pressing": [{ "text": "…", "link": "optional, one of: ${LINK_CHOICES.join(", ")}" }],
  "employees": [{ "id": "<roster id>", "line": "…", "status": "active" | "quiet" | "issue" }]
}

Rules:
- "pressing": 0–5 items, most urgent first — decisions waiting, failures, money on the line, deadlines. NEW findings beat routine status. If truly nothing is pressing, return [].
- "employees": EXACTLY one entry per roster member below, same ids. Each "line" is one concrete standup sentence about THEIR last 24h with real numbers/specifics from the data (what they did, found, or flagged). If nothing is attributable to them, write a short quiet line (e.g. "Quiet day — nothing ran.") and status "quiet". Use "issue" when their work failed or surfaced a problem.
- Attribute run logs by agentId, signals by source, actions to the accounting/CFO staff. Never invent activity or numbers.
- Plain language, no filler, no hype. Every sentence must be skimmable in a glance.

## Roster
${rosterBlock}

## Agent runs (last 24h)
${logsBlock}

## Tool signals (last 24h)
${signalsBlock}

## Open questions waiting on the owner
${questionsBlock}

## Accounting actions logged recently
${actionsBlock}

Today's date: ${today}`;

  try {
    const res = await callClaude({
      systemPrompt:
        "You are the chief of staff for Tilt Hockey's HQ. You compress the company's last 24 hours into a precise, skimmable daily brief. You only state facts present in the provided data.",
      userMessage: prompt,
      model: CLAUDE_MODEL,
      maxTokens: 3000,
      temperature: 0.2,
    });
    const parsed = extractJson(res.text) as {
      topline?: string;
      pressing?: { text?: string; link?: string }[];
      employees?: { id?: string; line?: string; status?: string }[];
    };
    const byId = new Map(
      (parsed.employees ?? []).map((e) => [String(e.id ?? ""), e])
    );
    const employees: EmployeeLine[] = roster.map((r) => {
      const m = byId.get(r.id);
      const status =
        m?.status === "issue" ? "issue" : m?.status === "quiet" ? "quiet" : m ? "active" : "quiet";
      return {
        id: r.id,
        name: r.name,
        title: r.title,
        initials: r.initials,
        color: r.color,
        accent: r.accent,
        href: r.href,
        line: m?.line?.trim() || "Quiet day — nothing attributable in the last 24h.",
        status,
      };
    });
    return {
      date: today,
      generatedAt: new Date().toISOString(),
      topline: parsed.topline?.trim() || "All quiet across the company.",
      pressing: (parsed.pressing ?? [])
        .filter((p) => p.text?.trim())
        .slice(0, 5)
        .map((p) => ({
          text: p.text!.trim(),
          link: p.link && LINK_CHOICES.includes(p.link) ? p.link : undefined,
        })),
      employees,
    };
  } catch (err) {
    console.error("[daily-brief] generation failed, using fallback:", err);
    return fallbackBrief(today, roster, logs, signals, open);
  }
}

/** Today's brief — cached per calendar day; `force` regenerates now. */
export async function getDailyBrief(force = false): Promise<DailyBrief> {
  const today = new Date().toISOString().slice(0, 10);
  if (!force) {
    const cached = await kv.get<DailyBrief>(KEY).catch(() => null);
    if (cached && cached.date === today) return cached;
  }
  const brief = await generate(today);
  await kv.set(KEY, brief).catch(() => {});
  return brief;
}
