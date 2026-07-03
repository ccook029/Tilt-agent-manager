// ---------------------------------------------------------------------------
// policy-ledger.ts — The Accounting team's learning memory (Vercel KV)
//
// This is what makes Sterling (the CFO / Accounting Manager) get smarter over
// time. Every accounting decision Chris makes is distilled into a short,
// reusable RULE and stored here. On every run, the full ledger is injected
// into the CFO's system prompt as "Established Tilt Accounting Policies", so a
// question only ever has to be escalated to Chris ONCE.
//
// Two collections live here:
//   1. POLICIES   — learned rules ("Shopify payout fees → Merchant Fees 6010")
//   2. ESCALATIONS — open questions the CFO has surfaced to Chris, awaiting an
//                    answer. When answered, the answer becomes a policy and the
//                    escalation is marked resolved.
//
// Scale note: KV is the right tool here. If the ledger ever grows past a few
// hundred rules, graduate to embeddings/RAG and retrieve the top-k relevant
// policies instead of injecting all of them.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const POLICY_KEY = "accounting-policy-ledger";
const ESCALATION_KEY = "accounting-escalations";
const MAX_POLICIES = 1000;
const MAX_ESCALATIONS = 500;

// ---- Types ----------------------------------------------------------------

export interface AccountingPolicy {
  id: string;
  /** One-line rule, e.g. "Charges from 'Rink Time LLC' → Facility Rental (6200)". */
  rule: string;
  /** Optional category: categorization | reconciliation | coa | tax | write-off | general */
  category: string;
  /** What prompted the rule (the original question / situation). */
  context?: string;
  /** Who decided it — usually "Chris Cook", sometimes "Sterling Vance (CFO)". */
  decidedBy: string;
  /** ISO date the rule was learned. */
  dateLearned: string;
  /**
   * Graduation tracking. Graduation (auto-apply) is OFF in v1 — every action is
   * a proposal — but we still count consistent applications so the rule is
   * ready to graduate the moment Chris turns graduation on.
   */
  timesApplied: number;
  autoApply: boolean;
}

export interface Escalation {
  id: string;
  question: string;
  /** Why the CFO couldn't answer it himself (no policy, material amount, etc.). */
  reason: string;
  /** The CFO's recommended answer, so Chris can often just reply "yes". */
  recommendation?: string;
  /** Dollar amount at stake, if applicable — used to prioritise. */
  dollarAmount?: number;
  status: "open" | "resolved";
  raisedAt: string;
  resolvedAt?: string;
  /** The answer, once given. */
  answer?: string;
  /** Who answered it (defaults to the accounting owner). */
  answeredBy?: string;
  /** Delegation: the owner can hand a question to another staff member to
   * answer. Stored by email so the assignee's session can claim it. */
  assigneeEmail?: string;
  assigneeName?: string;
  assignedBy?: string;
  assignedAt?: string;
}

// ---- Policies -------------------------------------------------------------

export async function getPolicies(): Promise<AccountingPolicy[]> {
  return (await kv.get<AccountingPolicy[]>(POLICY_KEY)) ?? [];
}

/** Append a learned rule. Returns the created policy. */
export async function addPolicy(input: {
  rule: string;
  category?: string;
  context?: string;
  decidedBy?: string;
}): Promise<AccountingPolicy> {
  const policies = await getPolicies();
  const policy: AccountingPolicy = {
    id: `pol-${Date.now()}-${policies.length + 1}`,
    rule: input.rule.trim(),
    category: input.category ?? "general",
    context: input.context,
    decidedBy: input.decidedBy ?? "Chris Cook",
    dateLearned: new Date().toISOString(),
    timesApplied: 0,
    autoApply: false, // graduation is off in v1
  };
  const merged = [...policies, policy].slice(-MAX_POLICIES);
  await kv.set(POLICY_KEY, merged);
  return policy;
}

/**
 * Render the ledger as a text block for injection into the CFO's system prompt.
 * This is the mechanism by which the CFO "knows" past decisions.
 */
export async function renderPolicyBlock(): Promise<string> {
  const policies = await getPolicies();
  if (policies.length === 0) {
    return "ESTABLISHED TILT ACCOUNTING POLICIES:\n(None yet — this is a fresh ledger. As Chris answers your escalations, his decisions will be recorded here and you will apply them automatically going forward.)";
  }
  const lines = policies.map(
    (p) =>
      `- [${p.category}] ${p.rule}  (set by ${p.decidedBy} on ${p.dateLearned.slice(0, 10)})`
  );
  return [
    "ESTABLISHED TILT ACCOUNTING POLICIES:",
    "These are decisions Chris has already made. Apply them WITHOUT asking again.",
    ...lines,
  ].join("\n");
}

// ---- Escalations ----------------------------------------------------------

export async function getEscalations(): Promise<Escalation[]> {
  return (await kv.get<Escalation[]>(ESCALATION_KEY)) ?? [];
}

export async function getOpenEscalations(): Promise<Escalation[]> {
  return (await getEscalations()).filter((e) => e.status === "open");
}

/** Open questions delegated to a given person (matched by email). */
export async function getEscalationsAssignedTo(
  email: string
): Promise<Escalation[]> {
  const target = email.trim().toLowerCase();
  if (!target) return [];
  return (await getEscalations()).filter(
    (e) => e.status === "open" && e.assigneeEmail?.toLowerCase() === target
  );
}

/**
 * Delegate (or un-delegate) an open question to another staff member so they
 * can answer it. Pass `assignee: null` to clear the assignment.
 */
export async function assignEscalation(
  escalationId: string,
  assignee: { email: string; name: string } | null,
  assignedBy: string
): Promise<Escalation | null> {
  const escalations = await getEscalations();
  const idx = escalations.findIndex((e) => e.id === escalationId);
  if (idx === -1) return null;

  if (assignee) {
    escalations[idx] = {
      ...escalations[idx],
      assigneeEmail: assignee.email.trim().toLowerCase(),
      assigneeName: assignee.name.trim() || assignee.email.trim(),
      assignedBy,
      assignedAt: new Date().toISOString(),
    };
  } else {
    const { ...rest } = escalations[idx];
    delete rest.assigneeEmail;
    delete rest.assigneeName;
    delete rest.assignedBy;
    delete rest.assignedAt;
    escalations[idx] = rest;
  }
  await kv.set(ESCALATION_KEY, escalations);
  return escalations[idx];
}

/** Raise a new open question for Chris. De-dupes on identical question text. */
export async function addEscalations(
  items: Array<{
    question: string;
    reason: string;
    recommendation?: string;
    dollarAmount?: number;
  }>
): Promise<Escalation[]> {
  const existing = await getEscalations();
  const openQuestions = new Set(
    existing.filter((e) => e.status === "open").map((e) => e.question.trim().toLowerCase())
  );

  const created: Escalation[] = [];
  for (const item of items) {
    const key = item.question.trim().toLowerCase();
    if (openQuestions.has(key)) continue; // already pending — don't ask twice
    openQuestions.add(key);
    const esc: Escalation = {
      id: `esc-${Date.now()}-${created.length + 1}`,
      question: item.question.trim(),
      reason: item.reason,
      recommendation: item.recommendation,
      dollarAmount: item.dollarAmount,
      status: "open",
      raisedAt: new Date().toISOString(),
    };
    created.push(esc);
  }

  if (created.length > 0) {
    const merged = [...existing, ...created].slice(-MAX_ESCALATIONS);
    await kv.set(ESCALATION_KEY, merged);
  }
  return created;
}

/**
 * Resolve an escalation with Chris's answer AND record it as a learned policy
 * in one step. This is the "learning" pathway: answer → permanent rule.
 */
export async function resolveEscalation(
  escalationId: string,
  answer: string,
  answeredBy = "Chris Cook"
): Promise<AccountingPolicy | null> {
  const escalations = await getEscalations();
  const idx = escalations.findIndex((e) => e.id === escalationId);
  if (idx === -1) return null;

  escalations[idx] = {
    ...escalations[idx],
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    answer,
    answeredBy,
  };
  await kv.set(ESCALATION_KEY, escalations);

  // Distill the Q+A into a reusable rule.
  return addPolicy({
    rule: `${escalations[idx].question} → ${answer}`,
    category: "general",
    context: escalations[idx].reason,
    decidedBy: answeredBy,
  });
}
