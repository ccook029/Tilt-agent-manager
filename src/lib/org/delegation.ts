// ---------------------------------------------------------------------------
// org/delegation.ts — how a boss hands out work, in ONE place.
//
// This used to live inside agent-chat.ts, which meant the typed chat had it and
// the voice chat didn't: over voice the Chief of Staff had no roster and no
// protocol, so asked to get something to Nova he correctly answered that he
// couldn't. Two implementations of "talking to an agent" drifted, and the
// capability only existed in one of them.
//
// Both paths now build their delegation block from here, so a boss who can
// assign when typed can assign when spoken to.
// ---------------------------------------------------------------------------
import {
  getDepartmentById,
  getDirectReports,
  getEmployeeById,
  getOrgReach,
} from "./directory";
import type { Employee } from "./types";

export interface Delegation {
  /** Everyone this person can hand work to. Empty for a non-boss. */
  reach: Employee[];
  /** Their direct reports — the rest of `reach` is skip-level. */
  direct: Employee[];
  /** Bosses within reach, who can be told to plan a whole department. */
  bosses: Employee[];
  /** True when reach extends past direct reports (in practice, the Chief of Staff). */
  hasSkipLevelReach: boolean;
}

export function getDelegation(employeeId: string): Delegation {
  const direct = getDirectReports(employeeId).filter((r) => r.staffed && r.enabled);
  const reach = getOrgReach(employeeId).filter((r) => r.staffed && r.enabled);
  const bosses = reach.filter(
    (r) =>
      r.role === "manager" &&
      getDirectReports(r.id).some((x) => x.staffed && x.enabled)
  );
  return {
    reach,
    direct,
    bosses,
    hasSkipLevelReach: reach.length > direct.length,
  };
}

function rosterBlock(people: Employee[], directIds?: Set<string>): string {
  const byDept = new Map<string, Employee[]>();
  for (const r of people) {
    const list = byDept.get(r.departmentId) ?? [];
    list.push(r);
    byDept.set(r.departmentId, list);
  }
  return [...byDept.entries()]
    .map(([deptId, group]) => {
      const dept = getDepartmentById(deptId);
      const lines = group
        .map(
          (r) =>
            `    - ${r.id} — ${r.name}, ${r.title}${
              directIds && !directIds.has(r.id) ? " (skip-level)" : ""
            }`
        )
        .join("\n");
      return `  ${dept?.name ?? deptId}:\n${lines}`;
    })
    .join("\n");
}

export function assignProtocol(people: Employee[], directIds?: Set<string>): string {
  const skipNote = directIds
    ? `\nAnyone marked (skip-level) does not report to you directly. You can still assign to them when the work genuinely belongs to that person — say in the brief that it came from the founders, so their boss has the context on review.`
    : "";

  return `## Handing out work from this chat
When the discussion lands on something that should be produced, end your reply with ONE fenced block per piece of work:
\`\`\`assign
{ "assignee": "<employee-id>", "title": "<short title>", "brief": "<the full brief — specific enough to execute without guessing, folding in everything agreed in this chat>" }
\`\`\`
Who you can assign to (use these exact ids):
${rosterBlock(people, directIds)}${skipNote}
Don't emit an assign block for hypotheticals — only when the work is actually wanted. Never put anything after the assign block(s).`;
}

export function dispatchProtocol(bosses: Employee[]): string {
  const list = bosses
    .map((b) => {
      const dept = getDepartmentById(b.departmentId);
      return `  - ${b.departmentId} — ${dept?.name ?? b.departmentId} (${b.name})`;
    })
    .join("\n");
  return `## Setting a whole department in motion
When what's needed is not one piece of work but a department head planning their period against the founders' priorities, end your reply with:
\`\`\`dispatch
{ "department": "<department-id>", "direction": "<what the founders want this department focused on — the head reads this before planning>" }
\`\`\`
Departments you can set in motion:
${list}
That head then plans and hands out work to their own team. Use this for "get marketing on the spring push", not for a single deliverable — that's an assign block. Never put anything after the block(s).`;
}

/**
 * The full delegation section for a boss, or "" if they have nobody to hand
 * work to. `mode` only changes the closing sentence — what happens after the
 * block differs between a card you click and a conversation you're having.
 */
export function buildDelegationBlock(
  employeeId: string,
  mode: "typed" | "voice"
): string {
  const employee = getEmployeeById(employeeId);
  if (!employee) return "";
  const { reach, direct, bosses, hasSkipLevelReach } = getDelegation(employeeId);
  if (reach.length === 0) return "";

  const directIds = new Set(direct.map((d) => d.id));
  const parts = [
    assignProtocol(
      hasSkipLevelReach ? reach : direct,
      hasSkipLevelReach ? directIds : undefined
    ),
  ];
  if (hasSkipLevelReach && bosses.length > 0) parts.push(dispatchProtocol(bosses));

  parts.push(
    mode === "voice"
      ? `## Out loud
You are being spoken to, so the block itself is never read aloud — say in plain words who you're giving it to and what they'll do, and put the block at the very end. It is acted on as soon as you finish speaking, and the result lands in the founders' review queue for approval, so you are proposing work, not shipping it. Only emit one when they've actually asked for the thing.`
      : `The founder confirms each block with one click, which runs the full worker → review cycle and lands the result in their Review queue.`
  );

  return parts.join("\n\n");
}
