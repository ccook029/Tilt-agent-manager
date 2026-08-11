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
import { sendPush } from "./push";

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

/**
 * What a question is ABOUT, in machine form. Present when Penny (or a code
 * guard) held a specific bank transaction: the desk shows the money and
 * offers one-tap actions that really execute.
 */
export interface EscalationContext {
  transactionId?: string;
  amount?: number;
  date?: string;
  payee?: string;
  /** What answering "yes, go ahead" should DO. */
  proposedAction?:
    | { type: "post"; account: string; direction: "in" | "out"; tax?: string }
    | { type: "apply_to_invoice"; invoiceNumber: string }
    | { type: "match" };
  /** Short label for the affirmative button, e.g. "Yes — post it". */
  affirmativeLabel?: string;
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
  /**
   * Structured context for questions raised about a specific bank line, so the
   * answering UI can show the money AND act on it — "yes, post it" actually
   * posts, instead of only recording a policy the next run has to re-derive.
   */
  context?: EscalationContext;
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
    context?: EscalationContext;
  }>
): Promise<Escalation[]> {
  const existing = await getEscalations();
  const open = existing.filter((e) => e.status === "open");
  // Fuzzy key: punctuation/whitespace/number-formatting differences shouldn't
  // create a "new" question. Without this, every re-run re-raised near-identical
  // questions and the queue ballooned.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  const openQuestions = new Set(open.map((e) => norm(e.question)));
  // One open question per bank line, ever — the strongest dedup we have.
  const openTxnIds = new Set(
    open.map((e) => e.context?.transactionId).filter((id): id is string => Boolean(id))
  );

  const created: Escalation[] = [];
  for (const item of items) {
    const key = norm(item.question);
    if (openQuestions.has(key)) continue; // already pending — don't ask twice
    const txnId = item.context?.transactionId;
    if (txnId && openTxnIds.has(txnId)) continue; // this line is already queued
    openQuestions.add(key);
    if (txnId) openTxnIds.add(txnId);
    const esc: Escalation = {
      id: `esc-${Date.now()}-${created.length + 1}`,
      question: item.question.trim(),
      reason: item.reason,
      recommendation: item.recommendation,
      dollarAmount: item.dollarAmount,
      context: item.context,
      status: "open",
      raisedAt: new Date().toISOString(),
    };
    created.push(esc);
  }

  if (created.length > 0) {
    const merged = [...existing, ...created].slice(-MAX_ESCALATIONS);
    await kv.set(ESCALATION_KEY, merged);
    void sendPush({
      title: "A decision needs you",
      body:
        created.length === 1
          ? created[0].question
          : `${created.length} questions are waiting on you.`,
      url: "/strategy",
      tag: "escalation",
    }).catch(() => {});
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

/**
 * Close a question WITHOUT distilling a policy — for ones that are noise, a
 * duplicate of another, or already handled elsewhere. Keeps the queue honest:
 * "resolved" shouldn't require inventing a rule.
 */
export async function dismissEscalation(
  escalationId: string,
  note = "Dismissed — no longer needs an answer",
  by = "Chris Cook"
): Promise<boolean> {
  const escalations = await getEscalations();
  const idx = escalations.findIndex((e) => e.id === escalationId);
  if (idx === -1) return false;
  escalations[idx] = {
    ...escalations[idx],
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    answer: note,
    answeredBy: by,
  };
  await kv.set(ESCALATION_KEY, escalations);
  return true;
}

/** Close several questions at once (used by the "already answered" sweep). */
export async function closeEscalations(
  items: Array<{ id: string; note: string }>,
  by = "Penny Quill"
): Promise<number> {
  if (items.length === 0) return 0;
  const escalations = await getEscalations();
  const byId = new Map(items.map((i) => [i.id, i.note]));
  let closed = 0;
  for (let i = 0; i < escalations.length; i++) {
    const note = byId.get(escalations[i].id);
    if (!note || escalations[i].status !== "open") continue;
    escalations[i] = {
      ...escalations[i],
      status: "resolved",
      resolvedAt: new Date().toISOString(),
      answer: note,
      answeredBy: by,
    };
    closed++;
  }
  if (closed > 0) await kv.set(ESCALATION_KEY, escalations);
  return closed;
}
