// ---------------------------------------------------------------------------
// agent-chat.ts — talk to any agent or org employee.
//
// Registry agents (Dana, Stockton, …) chat with their persona/system prompt,
// the shared company knowledge, and their own most-recent reports.
//
// Org employees (Harper, Marnie, …) chat with their employee-config prompt +
// live department context. Department BOSSES additionally get their team's
// recent work orders and scheduled reports as grounding, so Chris can ask
// "give me the high level on Sage's SEO findings" and drill down from there —
// and they can hand out agreed work straight from the chat via ```assign
// blocks (the UI turns each into a one-click "Assign & run" card).
// ---------------------------------------------------------------------------
import { callClaude } from "./anthropic";
import { CLAUDE_MODEL, CLAUDE_MANAGER_MODEL } from "./models";
import { getAgentById } from "./agent-registry";
import { getRunLogsByAgent } from "./store";
import { renderOrgKnowledge } from "./org-knowledge";
import { renderCrossAgentSignals } from "./cross-agent";
import { renderOrderBuilderContext } from "./order-builder/logic";
import { loadAgentChat, appendAgentChat } from "./agent-chat-store";
import {
  getEmployeeById,
  getDepartmentById,
  getDirectReports,
} from "./org/directory";
import {
  getEmployeeProfile,
  buildDefaultSystemPrompt,
} from "./org/employee-configs";
import { renderDepartmentContext } from "./org/department-context";
import { listWorkOrders } from "./org/work-orders";
import type { Employee, WorkOrder } from "./org/types";

// Agents with a dedicated, richer chat surface of their own — the generic
// path stays out of their way.
const DEDICATED = new Set(["accounting-manager", "accounting", "product-design"]);

export function isChattable(agentId: string): boolean {
  if (DEDICATED.has(agentId)) return false;
  if (getAgentById(agentId)) return true;
  const employee = getEmployeeById(agentId);
  return Boolean(employee && employee.staffed && employee.enabled);
}

export interface AgentChatTurn {
  reply: string;
}

function trimmedDraft(order: WorkOrder, chars: number): string {
  const draft = order.rounds[order.rounds.length - 1]?.draft ?? "";
  return draft.trim().slice(0, chars);
}

function renderOrders(orders: WorkOrder[], fullChars: number): string {
  return orders
    .map((o, i) => {
      const head = `- [${o.status}] "${o.title}" (${o.updatedAt.slice(0, 10)})`;
      // Full text for the most recent order, one-line preview for older ones.
      const body =
        i === 0
          ? trimmedDraft(o, fullChars)
          : trimmedDraft(o, 240).replace(/\s+/g, " ");
      return body ? `${head}\n${body}` : head;
    })
    .join("\n\n");
}

/** The boss's grounding: what each direct report has produced lately —
 * their work orders through the engine AND their scheduled-run reports. */
async function renderTeamWork(reports: Employee[]): Promise<string> {
  const sections = await Promise.all(
    reports.map(async (member) => {
      const [orders, logs] = await Promise.all([
        listWorkOrders({ assigneeId: member.id, limit: 3 }).catch(() => []),
        getRunLogsByAgent(member.id).catch(() => []),
      ]);
      const parts: string[] = [];
      if (orders.length) parts.push(renderOrders(orders, 2600));
      for (const log of logs.slice(0, 2)) {
        parts.push(
          `- [scheduled report, ${log.status}] ${log.startedAt.slice(0, 10)}\n${log.output.slice(0, 2600)}`
        );
      }
      if (!parts.length) return `### ${member.name} — ${member.title}\n(nothing produced yet)`;
      return `### ${member.name} — ${member.title} (id: ${member.id})\n${parts.join("\n\n")}`;
    })
  );
  return sections.join("\n\n---\n\n");
}

function assignProtocol(reports: Employee[]): string {
  const roster = reports
    .map((r) => `  - ${r.id} — ${r.name}, ${r.title}`)
    .join("\n");
  return `## Handing out work from this chat
When the discussion lands on something your team should produce, end your reply with ONE fenced block per piece of work:
\`\`\`assign
{ "assignee": "<employee-id>", "title": "<short title>", "brief": "<the full brief — specific enough to execute without guessing, folding in everything agreed in this chat>" }
\`\`\`
Your team (use these exact ids):
${roster}
The founder confirms each block with one click, which runs the full worker → your-review cycle and lands the result in their Review queue. Don't emit an assign block for hypotheticals — only when the work is actually wanted. Never put anything after the assign block(s).`;
}

export interface ChatImage {
  mediaType: string;
  data: string; // base64, no data: prefix
}

export async function runAgentConversation(
  agentId: string,
  message: string,
  clientHistory: { role: "user" | "assistant"; content: string }[] = [],
  images: ChatImage[] = []
): Promise<AgentChatTurn> {
  const config = getAgentById(agentId);
  const employee = getEmployeeById(agentId);
  if (!config && !employee) throw new Error(`Unknown agent: ${agentId}`);

  const department = employee ? getDepartmentById(employee.departmentId) : undefined;
  const teamReports = employee
    ? getDirectReports(employee.id).filter((r) => r.staffed && r.enabled)
    : [];
  const isManager = teamReports.length > 0;
  const name = config?.name ?? employee!.name;

  const stored = await loadAgentChat(agentId).catch(() => ({ messages: [] }));
  const history = stored.messages.length ? stored.messages : clientHistory;

  const logs = await getRunLogsByAgent(agentId).catch(() => []);
  const reports =
    logs
      .slice(0, 3)
      .map(
        (l) =>
          `### ${l.agentName} — ${l.startedAt.slice(0, 10)} (${l.status})\n${l.output.slice(0, 4000)}`
      )
      .join("\n\n---\n\n") || "(no reports produced yet — say what you'd run to find out)";

  const historyBlock =
    history
      .slice(-12)
      .map((m) => `${m.role === "user" ? "Team" : name}: ${m.content.slice(0, 1500)}`)
      .join("\n\n") || "(no prior messages)";

  // Base persona: registry config first, then the org prompt profile, then
  // the synthesized default from the directory.
  const profile = employee ? getEmployeeProfile(employee.id) : undefined;
  const basePrompt =
    config?.systemPrompt ??
    profile?.systemPrompt ??
    profile?.managerSystemPrompt ??
    buildDefaultSystemPrompt(employee!, department!);

  const systemPrompt =
    basePrompt +
    (await renderOrgKnowledge().catch(() => "")) +
    (await renderCrossAgentSignals(agentId).catch(() => "")) +
    // Stockton owns the Order Builder — give him its methodology + live
    // demand/stock numbers so he can explain how a recommendation was derived.
    (agentId === "inventory"
      ? await renderOrderBuilderContext().catch(() => "")
      : "");

  // Org grounding: live department data, own work orders, and — for bosses —
  // everything the team has produced lately.
  let orgBlocks = "";
  if (employee) {
    const [deptContext, ownOrders, teamWork] = await Promise.all([
      renderDepartmentContext(employee).catch(() => ""),
      listWorkOrders({ assigneeId: employee.id, limit: 4 }).catch(() => []),
      isManager ? renderTeamWork(teamReports) : Promise.resolve(""),
    ]);
    if (deptContext) orgBlocks += `\n\n${deptContext}`;
    if (ownOrders.length)
      orgBlocks += `\n\n## Your recent work orders\n${renderOrders(ownOrders, 2600)}`;
    if (teamWork)
      orgBlocks += `\n\n## Your team's recent work (you have already read all of this)\n${teamWork}`;
  }

  const managerGuidance = isManager
    ? `\n\nYou are the department boss. When asked about your team's work, LEAD WITH THE HIGH LEVEL — the few findings or takeaways that matter, in a handful of tight sentences — and offer the threads worth pulling. Do NOT re-dump a report; the founder can drill down by asking. Have a point of view: what you'd act on, what you'd skip, and why.\n\n${assignProtocol(teamReports)}`
    : "";

  const imageNote = images.length
    ? `\n\nThey attached ${images.length} screenshot${images.length > 1 ? "s" : ""} (shown to you above the text) — look at ${images.length > 1 ? "them" : "it"} carefully; ${images.length > 1 ? "they are" : "it is"} what they're talking about.`
    : "";

  const userMessage = `You are ${name}, chatting live with the Tilt team (Chris, Jeremy, or staff). Answer their message directly and specifically, grounded in your recent work below and what you know about Tilt. If you don't have the data, say exactly what you'd run or need — don't invent numbers. Keep it conversational and tight; this is a chat, not an email.${managerGuidance}${imageNote}

## Your most recent reports
${reports}${orgBlocks}

## Conversation so far
${historyBlock}

## Their message
${message}`;

  const res = await callClaude({
    systemPrompt,
    userMessage,
    model: config?.model ?? (isManager ? CLAUDE_MANAGER_MODEL : CLAUDE_MODEL),
    maxTokens: isManager ? 2200 : 1600,
    temperature: 0.4,
    images,
  });

  // The stored transcript is text-only — note the attachment instead of
  // persisting base64 blobs into KV.
  const storedMessage = images.length
    ? `[${images.length} screenshot${images.length > 1 ? "s" : ""} attached] ${message}`
    : message;
  await appendAgentChat(agentId, storedMessage, res.text).catch(() => {});
  return { reply: res.text };
}
