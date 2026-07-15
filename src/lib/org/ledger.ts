// ---------------------------------------------------------------------------
// org/ledger.ts — Per-department policy ledger + escalation queue (Vercel KV)
//
// The generalization of policy-ledger.ts: every department gets the same
// learning memory the accounting team proved out. A boss resolves what
// existing policy covers, escalates the rest to the owner, and the owner's
// answer is distilled into a permanent rule — so each question is asked once.
//
// Backward compatibility: the FINANCE department reads and writes the exact
// KV keys the accounting team already uses ("accounting-policy-ledger" /
// "accounting-escalations") with identical record shapes, so the existing
// Sterling/Penny loop, the /questions page, and all stored history keep
// working untouched while new departments get their own namespaced keys.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import type { AccountingPolicy, Escalation } from "../policy-ledger";

export type DepartmentPolicy = AccountingPolicy;
export type { Escalation };

const LEGACY_FINANCE_POLICY_KEY = "accounting-policy-ledger";
const LEGACY_FINANCE_ESCALATION_KEY = "accounting-escalations";
const MAX_POLICIES = 1000;
const MAX_ESCALATIONS = 500;

function policyKey(departmentId: string): string {
  return departmentId === "finance"
    ? LEGACY_FINANCE_POLICY_KEY
    : `org-policy-ledger:${departmentId}`;
}

function escalationKey(departmentId: string): string {
  return departmentId === "finance"
    ? LEGACY_FINANCE_ESCALATION_KEY
    : `org-escalations:${departmentId}`;
}

// ---- Policies ---------------------------------------------------------------

export async function getPolicies(
  departmentId: string
): Promise<DepartmentPolicy[]> {
  return (await kv.get<DepartmentPolicy[]>(policyKey(departmentId))) ?? [];
}

export async function addPolicy(
  departmentId: string,
  input: { rule: string; category?: string; context?: string; decidedBy?: string }
): Promise<DepartmentPolicy> {
  const policies = await getPolicies(departmentId);
  const policy: DepartmentPolicy = {
    id: `pol-${Date.now()}-${policies.length + 1}`,
    rule: input.rule.trim(),
    category: input.category ?? "general",
    context: input.context,
    decidedBy: input.decidedBy ?? "Chris Cook",
    dateLearned: new Date().toISOString(),
    timesApplied: 0,
    autoApply: false, // graduation stays off until the owner turns it on
  };
  await kv.set(
    policyKey(departmentId),
    [...policies, policy].slice(-MAX_POLICIES)
  );
  return policy;
}

/** Render the department's learned rules for prompt injection. */
export async function renderPolicyBlock(
  departmentId: string,
  departmentName: string
): Promise<string> {
  const policies = await getPolicies(departmentId);
  const header = `ESTABLISHED TILT ${departmentName.toUpperCase()} POLICIES:`;
  if (policies.length === 0) {
    return `${header}\n(None yet — as Chris answers this department's escalations, his decisions are recorded here and applied automatically going forward.)`;
  }
  return [
    header,
    "These are decisions Chris has already made. Apply them WITHOUT asking again.",
    ...policies.map(
      (p) =>
        `- [${p.category}] ${p.rule}  (set by ${p.decidedBy} on ${p.dateLearned.slice(0, 10)})`
    ),
  ].join("\n");
}

// ---- Escalations --------------------------------------------------------------

export async function getEscalations(
  departmentId: string
): Promise<Escalation[]> {
  return (await kv.get<Escalation[]>(escalationKey(departmentId))) ?? [];
}

export async function getOpenEscalations(
  departmentId: string
): Promise<Escalation[]> {
  return (await getEscalations(departmentId)).filter((e) => e.status === "open");
}

/** Raise new owner-level questions. De-dupes on identical open question text. */
export async function addEscalations(
  departmentId: string,
  items: Array<{
    question: string;
    reason: string;
    recommendation?: string;
    dollarAmount?: number;
  }>
): Promise<Escalation[]> {
  const existing = await getEscalations(departmentId);
  const openQuestions = new Set(
    existing
      .filter((e) => e.status === "open")
      .map((e) => e.question.trim().toLowerCase())
  );

  const created: Escalation[] = [];
  for (const item of items) {
    const key = item.question.trim().toLowerCase();
    if (!key || openQuestions.has(key)) continue;
    openQuestions.add(key);
    created.push({
      id: `esc-${Date.now()}-${created.length + 1}`,
      question: item.question.trim(),
      reason: item.reason,
      recommendation: item.recommendation,
      dollarAmount: item.dollarAmount,
      status: "open",
      raisedAt: new Date().toISOString(),
    });
  }

  if (created.length > 0) {
    await kv.set(
      escalationKey(departmentId),
      [...existing, ...created].slice(-MAX_ESCALATIONS)
    );
  }
  return created;
}

/**
 * Resolve an escalation with the owner's answer AND record it as a learned
 * policy in one step — the "never ask twice" pathway.
 */
export async function resolveEscalation(
  departmentId: string,
  escalationId: string,
  answer: string,
  answeredBy = "Chris Cook"
): Promise<DepartmentPolicy | null> {
  const escalations = await getEscalations(departmentId);
  const idx = escalations.findIndex((e) => e.id === escalationId);
  if (idx === -1) return null;

  escalations[idx] = {
    ...escalations[idx],
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    answer,
    answeredBy,
  };
  await kv.set(escalationKey(departmentId), escalations);

  return addPolicy(departmentId, {
    rule: `${escalations[idx].question} → ${answer}`,
    category: "general",
    context: escalations[idx].reason,
    decidedBy: answeredBy,
  });
}
