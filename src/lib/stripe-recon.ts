// ---------------------------------------------------------------------------
// stripe-recon.ts — Penny's Stripe ⇄ Zoho Books reconciliation.
//
// THE ACCOUNTING (why the postings look the way they do)
//
//   1. Web sale → invoice raised          Dr A/R          Cr Revenue + HST
//      (tiltweb already does this on every order)
//
//   2. Card paid at checkout              Dr Stripe Clearing   Cr A/R
//      The money is real but Stripe is still holding it, so it lands in the
//      CLEARING account — never the bank. tiltweb attempts this too, but every
//      call site swallows the error (see tiltweb src/lib/zoho-books.ts
//      recordPayment), so failures are invisible and invoices silently stay
//      unpaid. Penny finds those leaks and repairs them.
//
//   3. Stripe payout lands in the bank    Dr Chequing (net)
//                                         Dr Merchant Fees (+ HST ITC)
//                                                        Cr Stripe Clearing
//      Nothing does this today — this is the genuinely missing leg, and the
//      reason Stripe Clearing never returns to zero. We post it as two pieces:
//      a fee expense paid THROUGH clearing, then a plain fund transfer of the
//      net matched to the real bank feed line. That way the bank line matches
//      to the penny and no hand-written journal entry is needed.
//
// The self-check that makes this trustworthy: after a clean run, Stripe
// Clearing should hold only in-transit money. Debits (payments in) equal
// credits (fees + payouts out). If clearing doesn't clear, something didn't
// match — and that is a real finding, not a rounding artifact.
//
// THE JOIN KEY
//
//   tiltweb writes the Stripe PaymentIntent id into the Zoho invoice's
//   reference_number, and writes tilt_invoice_id/tilt_invoice_number back onto
//   the PaymentIntent metadata. So the link is exact and bidirectional:
//     payout → balance_transaction → charge → payment_intent → reference_number
//   No fuzzy matching on email + amount + date anywhere in this file.
//
// SAFETY
//
//   Stripe access is read-only (see stripe.ts — GET only). Every write goes to
//   Zoho, is idempotency-guarded on a reference_number lookup, and by default
//   is only ever PROPOSED. Nothing posts without an explicit approval.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import {
  centsToDollars,
  chargeFromTxn,
  describeStripeKey,
  fetchPayouts,
  fetchPayoutTransactions,
  invoiceHintFromCharge,
  invoiceRefForCharge,
  isPayoutSelf,
  stripeConfigured,
  unixToDate,
  type StripeBalanceTransaction,
  type StripeCharge,
  type StripePayout,
} from "./stripe";
import {
  categorizeTxnAsTransfer,
  createCustomerPayment,
  createExpense,
  fetchBankAccounts,
  fetchChartOfAccounts,
  fetchTaxes,
  fetchUncategorizedTxnsForAccount,
  findCustomerPaymentByReference,
  findExpenseByReference,
  findInvoiceByReference,
  txnDirection,
  type BooksBankTxn,
} from "./zoho-books";

const PROPOSALS_KEY = "stripe-recon:proposals";
const LAST_RUN_KEY = "stripe-recon:last-run";

/** Default reconciliation window. 90 days proves the mechanism on real data
 *  without dragging in years of history on the first run. */
export const DEFAULT_WINDOW_DAYS = 90;

/** How far the bank feed line's date may drift from Stripe's arrival_date and
 *  still be considered the same deposit. Banks post a day or two late. */
const BANK_DATE_SLOP_DAYS = 4;

// ---- Config resolution ----------------------------------------------------

export interface ReconAccounts {
  clearingId?: string;
  clearingName: string;
  bankId?: string;
  bankName: string;
  feeId?: string;
  feeName: string;
  /** HST tax code applied to Stripe's fee, when Stripe itemizes tax on it. */
  feeTaxId?: string;
  feeTaxName?: string;
  problems: string[];
}

/** Candidate names for the merchant-fee expense account, best first. Overridden
 *  by ZOHO_STRIPE_FEE_ACCOUNT when the real account is named something else. */
const FEE_ACCOUNT_CANDIDATES = [
  "merchant fees",
  "merchant service fees",
  "merchant account fees",
  "payment processing fees",
  "processing fees",
  "transaction fees",
  "bank fees and charges",
  "bank charges",
  "bank fees",
];

/**
 * Resolve every account this reconciliation touches, by name, against the real
 * Chart of Accounts. Returns `problems` rather than throwing so the diagnose
 * route can show all the gaps at once instead of one per round trip.
 */
export async function resolveReconAccounts(): Promise<ReconAccounts> {
  const clearingName = process.env.ZOHO_STRIPE_CLEARING_ACCOUNT || "Stripe Clearing";
  const bankName = process.env.ZOHO_MAIN_BANK_ACCOUNT || "Main Checking Account";
  const feeNameOverride = process.env.ZOHO_STRIPE_FEE_ACCOUNT;

  const problems: string[] = [];

  const [banks, coa, taxes] = await Promise.all([
    fetchBankAccounts().catch(() => []),
    fetchChartOfAccounts().catch(() => []),
    fetchTaxes().catch(() => []),
  ]);

  const byName = (name: string) => {
    const want = name.trim().toLowerCase();
    const bank = banks.find((a) => a.account_name.trim().toLowerCase() === want);
    if (bank) return bank.account_id;
    const acct = coa.find((a) => a.account_name.trim().toLowerCase() === want);
    return acct?.account_id;
  };

  const clearingId = byName(clearingName);
  if (!clearingId) {
    problems.push(
      `No account named "${clearingName}" in Zoho Books. Set ZOHO_STRIPE_CLEARING_ACCOUNT to the real name.`
    );
  }

  const bankId = byName(bankName);
  if (!bankId) {
    problems.push(
      `No bank account named "${bankName}" in Zoho Books. Set ZOHO_MAIN_BANK_ACCOUNT to the real name.`
    );
  }

  // Fee account: explicit override wins; otherwise take the first expense
  // account whose name matches a known merchant-fee wording.
  let feeId: string | undefined;
  let feeName = feeNameOverride ?? "";
  if (feeNameOverride) {
    feeId = byName(feeNameOverride);
    if (!feeId) {
      problems.push(
        `ZOHO_STRIPE_FEE_ACCOUNT is set to "${feeNameOverride}" but no such account exists in Zoho Books.`
      );
    }
  } else {
    const expenses = coa.filter((a) =>
      /expense|cost_of_goods_sold/i.test(a.account_type)
    );
    for (const candidate of FEE_ACCOUNT_CANDIDATES) {
      const hit = expenses.find(
        (a) => a.account_name.trim().toLowerCase() === candidate
      );
      if (hit) {
        feeId = hit.account_id;
        feeName = hit.account_name;
        break;
      }
    }
    if (!feeId) {
      // Second pass: contains-match, so "Bank Charges & Merchant Fees" is found.
      const hit = expenses.find((a) =>
        FEE_ACCOUNT_CANDIDATES.some((c) =>
          a.account_name.trim().toLowerCase().includes(c)
        )
      );
      if (hit) {
        feeId = hit.account_id;
        feeName = hit.account_name;
      }
    }
    if (!feeId) {
      problems.push(
        "Could not find a merchant-fee expense account. Set ZOHO_STRIPE_FEE_ACCOUNT " +
          "to the exact name of the account Stripe's fees should hit."
      );
      feeName = "(not found)";
    }
  }

  // HST on Stripe's fee. Only used when Stripe itemizes a tax line on the fee —
  // see feeSplit() below. We never invent a tax code that Stripe didn't charge.
  const taxNameOverride = process.env.ZOHO_FEE_TAX_NAME;
  const tax = taxNameOverride
    ? taxes.find(
        (t) => t.tax_name.trim().toLowerCase() === taxNameOverride.trim().toLowerCase()
      )
    : taxes.find((t) => /^hst/i.test(t.tax_name.trim()));

  return {
    clearingId,
    clearingName,
    bankId,
    bankName,
    feeId,
    feeName,
    feeTaxId: tax?.tax_id,
    feeTaxName: tax?.tax_name,
    problems,
  };
}

// ---- Reconciliation model -------------------------------------------------

export type ChargeState =
  /** Invoice found and already fully paid — nothing to do. */
  | "settled"
  /** Invoice found but still carrying a balance — the payment leg leaked. */
  | "payment_missing"
  /** Charge succeeded but no Zoho invoice carries its PaymentIntent id. */
  | "invoice_missing";

export interface ChargeRecon {
  chargeId: string;
  /** The PaymentIntent id — the join key. */
  reference: string;
  grossCents: number;
  feeCents: number;
  date: string;
  customerEmail?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceBalance?: number;
  customerId?: string;
  state: ChargeState;
  /** Set when a customer payment with this reference already exists. */
  existingPaymentId?: string;
}

export interface PayoutRecon {
  payoutId: string;
  arrivalDate: string;
  status: string;
  currency: string;
  /** Sum of the sales that funded this payout, in cents. */
  grossCents: number;
  /** Stripe's total cut, in cents. */
  feeCents: number;
  /** The tax portion of feeCents, when Stripe itemized it. */
  feeTaxCents: number;
  /** What actually hits the bank, in cents. */
  netCents: number;
  charges: ChargeRecon[];
  /** Refunds, adjustments and disputes inside this payout — real money that
   *  isn't a plain sale, so it needs a human rather than an auto-posting. */
  otherLines: Array<{ id: string; type: string; amountCents: number; description?: string }>;
  /** The matched uncategorized bank feed line, if we found one. */
  bankTxnId?: string;
  bankTxnDate?: string;
  /** True when the fee expense for this payout already exists in Zoho. */
  feeAlreadyPosted: boolean;
  notes: string[];
}

export type ProposalKind = "payment" | "fee" | "transfer";

export interface ReconProposal {
  id: string;
  kind: ProposalKind;
  /** One-line human summary — what this posting does, in plain English. */
  summary: string;
  /** The double entry, spelled out. */
  debit: string;
  credit: string;
  amount: number; // dollars
  date: string;
  /** The Stripe object this came from, for traceability. */
  stripeRef: string;
  status: "pending" | "approved" | "rejected" | "failed";
  /** Set once posted. */
  postedId?: string;
  error?: string;
  /** Everything needed to execute without re-reading Stripe. */
  payload: Record<string, unknown>;
}

export interface ReconRun {
  generatedAt: string;
  windowDays: number;
  since: string;
  accounts: ReconAccounts;
  payouts: PayoutRecon[];
  proposals: ReconProposal[];
  summary: {
    payouts: number;
    charges: number;
    settled: number;
    paymentsMissing: number;
    invoicesMissing: number;
    grossDollars: number;
    feeDollars: number;
    netDollars: number;
    unmatchedBankLines: number;
  };
  warnings: string[];
}

// ---- Fee split ------------------------------------------------------------

/**
 * Split a payout's total fee into the expense portion and the recoverable tax
 * (ITC) portion, using Stripe's OWN itemization. When Stripe doesn't report a
 * tax line, we post the whole fee with no tax code — claiming an ITC that was
 * never charged is worse than missing one, and this keeps the books honest
 * either way.
 */
function feeSplit(txns: StripeBalanceTransaction[]): { feeCents: number; taxCents: number } {
  let feeCents = 0;
  let taxCents = 0;
  for (const t of txns) {
    if (isPayoutSelf(t)) continue;
    feeCents += t.fee;
    for (const d of t.fee_details ?? []) {
      if (d.type === "tax") taxCents += d.amount;
    }
  }
  return { feeCents, taxCents };
}

// ---- Bank-line matching ---------------------------------------------------

function daysApart(a: string, b: string): number {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return ms / 86_400_000;
}

/**
 * Find the chequing deposit that IS this payout. Matched on amount to the cent
 * plus a few days of date slop — a Stripe payout arrives as one clean deposit,
 * so an exact-amount match within the window is unambiguous in practice. When
 * two lines tie on amount we take the closest date and note the ambiguity.
 */
function matchBankLine(
  payoutNetDollars: number,
  arrivalDate: string,
  candidates: BooksBankTxn[],
  /** Feed lines already claimed by an earlier payout in this run. Two payouts
   *  of the same amount days apart would otherwise both match the same deposit
   *  and propose the same transfer twice. */
  claimed: Set<string>
): { txn?: BooksBankTxn; note?: string } {
  const hits = candidates.filter((t) => {
    if (claimed.has(t.transaction_id)) return false;
    if (txnDirection(t) === "out") return false;
    if (Math.abs(Math.abs(t.amount) - payoutNetDollars) > 0.005) return false;
    return daysApart(t.date, arrivalDate) <= BANK_DATE_SLOP_DAYS;
  });

  if (hits.length === 0) return {};
  if (hits.length === 1) return { txn: hits[0] };

  hits.sort((a, b) => daysApart(a.date, arrivalDate) - daysApart(b.date, arrivalDate));
  return {
    txn: hits[0],
    note: `${hits.length} bank lines matched $${payoutNetDollars.toFixed(2)} near ${arrivalDate} — took the closest by date (${hits[0].date}). Worth an eyeball.`,
  };
}

// ---- The run --------------------------------------------------------------

/**
 * Reconcile the last `windowDays` of Stripe activity against Zoho Books.
 *
 * Read-only with respect to BOTH systems: this builds proposals and nothing
 * else. Call `approveProposal` to actually post.
 */
export async function buildStripeRecon(opts?: {
  windowDays?: number;
  /** Cap on payouts examined, so one run can't blow the function timeout. */
  maxPayouts?: number;
}): Promise<ReconRun> {
  const windowDays = opts?.windowDays ?? DEFAULT_WINDOW_DAYS;
  const maxPayouts = opts?.maxPayouts ?? 60;
  const warnings: string[] = [];

  if (!stripeConfigured()) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add a restricted (read-only) Stripe key to the hub's environment."
    );
  }

  const key = describeStripeKey();
  if (!key.restricted) {
    warnings.push(
      "The configured Stripe key is a full secret key (sk_…), not a restricted key (rk_…). " +
        "Penny only ever reads from Stripe, so a restricted read-only key is safer."
    );
  }

  const sinceUnix = Math.floor(Date.now() / 1000) - windowDays * 86_400;
  const since = unixToDate(sinceUnix);

  const accounts = await resolveReconAccounts();
  warnings.push(...accounts.problems);

  const payouts = await fetchPayouts(sinceUnix, maxPayouts);

  // Pull the chequing account's uncategorized feed once for the whole window
  // rather than per payout — one call instead of sixty.
  const bankCandidates = accounts.bankId
    ? await fetchUncategorizedTxnsForAccount(
        accounts.bankId,
        since,
        unixToDate(Math.floor(Date.now() / 1000) + 86_400)
      )
    : [];

  const recons: PayoutRecon[] = [];
  const proposals: ReconProposal[] = [];
  const claimedBankLines = new Set<string>();

  // Oldest payout first, so when two payouts share an amount the earlier one
  // claims the earlier deposit rather than whichever Stripe listed first.
  for (const payout of [...payouts].sort((a, b) => a.arrival_date - b.arrival_date)) {
    const recon = await reconcilePayout(payout, accounts, bankCandidates, claimedBankLines);
    if (recon.bankTxnId) claimedBankLines.add(recon.bankTxnId);
    recons.push(recon);
    proposals.push(...proposalsForPayout(recon, accounts));
  }

  const charges = recons.flatMap((r) => r.charges);
  const summary = {
    payouts: recons.length,
    charges: charges.length,
    settled: charges.filter((c) => c.state === "settled").length,
    paymentsMissing: charges.filter((c) => c.state === "payment_missing").length,
    invoicesMissing: charges.filter((c) => c.state === "invoice_missing").length,
    grossDollars: centsToDollars(recons.reduce((s, r) => s + r.grossCents, 0)),
    feeDollars: centsToDollars(recons.reduce((s, r) => s + r.feeCents, 0)),
    netDollars: centsToDollars(recons.reduce((s, r) => s + r.netCents, 0)),
    unmatchedBankLines: recons.filter((r) => !r.bankTxnId).length,
  };

  const run: ReconRun = {
    generatedAt: new Date().toISOString(),
    windowDays,
    since,
    accounts,
    payouts: recons,
    proposals,
    summary,
    warnings,
  };

  await kv.set(PROPOSALS_KEY, proposals);
  await kv.set(LAST_RUN_KEY, { ...run, payouts: recons.slice(0, 40) });

  return run;
}

async function reconcilePayout(
  payout: StripePayout,
  accounts: ReconAccounts,
  bankCandidates: BooksBankTxn[],
  claimedBankLines: Set<string>
): Promise<PayoutRecon> {
  const notes: string[] = [];
  const arrivalDate = unixToDate(payout.arrival_date);

  const txns = await fetchPayoutTransactions(payout.id);
  const funding = txns.filter((t) => !isPayoutSelf(t));

  const { feeCents, taxCents } = feeSplit(funding);
  const grossCents = funding.reduce((s, t) => s + t.amount, 0);
  const netCents = payout.amount;

  const charges: ChargeRecon[] = [];
  const otherLines: PayoutRecon["otherLines"] = [];

  for (const txn of funding) {
    const charge = chargeFromTxn(txn);
    if (!charge) {
      otherLines.push({
        id: txn.id,
        type: txn.type,
        amountCents: txn.amount,
        description: txn.description ?? undefined,
      });
      continue;
    }
    charges.push(await reconcileCharge(txn, charge));
  }

  if (otherLines.length > 0) {
    notes.push(
      `${otherLines.length} non-sale line(s) in this payout (${[...new Set(otherLines.map((o) => o.type))].join(", ")}). ` +
        "Refunds and adjustments are real money but aren't plain sales — they need your eyes, so no posting is proposed for them."
    );
  }

  // Fee already posted for this payout? Keyed on the payout id.
  const existingFee = accounts.feeId
    ? await findExpenseByReference(payout.id).catch(() => null)
    : null;

  const { txn: bankTxn, note: bankNote } = matchBankLine(
    centsToDollars(netCents),
    arrivalDate,
    bankCandidates,
    claimedBankLines
  );
  if (bankNote) notes.push(bankNote);
  if (!bankTxn) {
    notes.push(
      `No uncategorized deposit of $${centsToDollars(netCents).toFixed(2)} found in ${accounts.bankName} near ${arrivalDate}. ` +
        "Either the feed hasn't imported it yet, or it was already categorized by hand."
    );
  }

  // The arithmetic that must hold: gross − fees = what hit the bank.
  if (Math.abs(grossCents - feeCents - netCents) > 1) {
    notes.push(
      `Payout doesn't balance: gross $${centsToDollars(grossCents).toFixed(2)} − fees $${centsToDollars(feeCents).toFixed(2)} ` +
        `≠ net $${centsToDollars(netCents).toFixed(2)}. Not safe to post automatically.`
    );
  }

  return {
    payoutId: payout.id,
    arrivalDate,
    status: payout.status,
    currency: payout.currency.toUpperCase(),
    grossCents,
    feeCents,
    feeTaxCents: taxCents,
    netCents,
    charges,
    otherLines,
    bankTxnId: bankTxn?.transaction_id,
    bankTxnDate: bankTxn?.date,
    feeAlreadyPosted: !!existingFee,
    notes,
  };
}

async function reconcileCharge(
  txn: StripeBalanceTransaction,
  charge: StripeCharge
): Promise<ChargeRecon> {
  const reference = invoiceRefForCharge(charge);
  const hint = invoiceHintFromCharge(charge);

  const base: ChargeRecon = {
    chargeId: charge.id,
    reference,
    grossCents: txn.amount,
    feeCents: txn.fee,
    date: unixToDate(charge.created),
    customerEmail:
      charge.billing_details?.email ?? charge.receipt_email ?? undefined,
    invoiceNumber: hint.invoiceNumber,
    invoiceId: hint.invoiceId,
    state: "invoice_missing",
  };

  const invoice = await findInvoiceByReference(reference).catch(() => null);
  if (!invoice) return base;

  const existingPayment = await findCustomerPaymentByReference(reference).catch(
    () => null
  );

  return {
    ...base,
    invoiceId: invoice.invoice_id,
    invoiceNumber: invoice.invoice_number,
    invoiceBalance: invoice.balance,
    customerId: invoice.customer_id,
    existingPaymentId: existingPayment?.payment_id,
    // A payment already recorded, or a zero balance, means this one is done.
    state:
      existingPayment || (invoice.balance ?? 0) <= 0.005
        ? "settled"
        : "payment_missing",
  };
}

// ---- Proposal generation --------------------------------------------------

function proposalsForPayout(
  recon: PayoutRecon,
  accounts: ReconAccounts
): ReconProposal[] {
  const out: ReconProposal[] = [];
  const blocked = recon.notes.some((n) => n.startsWith("Payout doesn't balance"));

  // 1. Repair the leaked payment leg, one per charge whose invoice is unpaid.
  for (const charge of recon.charges) {
    if (charge.state !== "payment_missing") continue;
    if (!charge.invoiceId || !charge.customerId || !accounts.clearingId) continue;

    // Pay the smaller of the charge and the outstanding balance — a partial
    // refund or a manual part-payment shouldn't cause an overpayment.
    const amount = Math.min(
      centsToDollars(charge.grossCents),
      charge.invoiceBalance ?? centsToDollars(charge.grossCents)
    );
    if (amount <= 0) continue;

    out.push({
      id: `payment:${charge.reference}`,
      kind: "payment",
      summary: `Mark ${charge.invoiceNumber ?? "invoice"} paid — $${amount.toFixed(2)} card payment${charge.customerEmail ? ` from ${charge.customerEmail}` : ""}`,
      debit: `${accounts.clearingName} $${amount.toFixed(2)}`,
      credit: `Accounts Receivable $${amount.toFixed(2)}`,
      amount,
      date: charge.date,
      stripeRef: charge.reference,
      status: "pending",
      payload: {
        customerId: charge.customerId,
        invoiceId: charge.invoiceId,
        invoiceNumber: charge.invoiceNumber,
        amount,
        date: charge.date,
        accountId: accounts.clearingId,
        reference: charge.reference,
        description: `Stripe payment ${charge.reference}`,
      },
    });
  }

  if (blocked) return out;

  // 2. Stripe's cut for the whole payout, expensed THROUGH clearing.
  const feeDollars = centsToDollars(recon.feeCents);
  if (feeDollars > 0 && !recon.feeAlreadyPosted && accounts.feeId && accounts.clearingId) {
    const taxDollars = centsToDollars(recon.feeTaxCents);
    const netFee = feeDollars - taxDollars;
    const taxed = taxDollars > 0 && !!accounts.feeTaxId;

    out.push({
      id: `fee:${recon.payoutId}`,
      kind: "fee",
      summary:
        `Stripe fees on payout ${recon.payoutId.slice(-8)} — $${feeDollars.toFixed(2)}` +
        (taxed
          ? ` (incl. $${taxDollars.toFixed(2)} ${accounts.feeTaxName} claimed as an ITC)`
          : " (Stripe reported no tax on this fee, so none is claimed)"),
      debit: taxed
        ? `${accounts.feeName} $${netFee.toFixed(2)} + ${accounts.feeTaxName} $${taxDollars.toFixed(2)}`
        : `${accounts.feeName} $${feeDollars.toFixed(2)}`,
      credit: `${accounts.clearingName} $${feeDollars.toFixed(2)}`,
      amount: feeDollars,
      date: recon.arrivalDate,
      stripeRef: recon.payoutId,
      status: "pending",
      payload: {
        accountId: accounts.feeId,
        paidThroughAccountId: accounts.clearingId,
        // Zoho adds the tax on top when tax_id is set, so send the net.
        amount: taxed ? netFee : feeDollars,
        taxId: taxed ? accounts.feeTaxId : undefined,
        date: recon.arrivalDate,
        reference: recon.payoutId,
        description: `Stripe processing fees — payout ${recon.payoutId}`,
      },
    });
  }

  // 3. The payout itself: clearing → bank, matched to the real feed line.
  const netDollars = centsToDollars(recon.netCents);
  if (recon.bankTxnId && netDollars > 0 && accounts.clearingId && accounts.bankId) {
    out.push({
      id: `transfer:${recon.payoutId}`,
      kind: "transfer",
      summary: `Stripe payout ${recon.payoutId.slice(-8)} — $${netDollars.toFixed(2)} into ${accounts.bankName}`,
      debit: `${accounts.bankName} $${netDollars.toFixed(2)}`,
      credit: `${accounts.clearingName} $${netDollars.toFixed(2)}`,
      amount: netDollars,
      date: recon.bankTxnDate ?? recon.arrivalDate,
      stripeRef: recon.payoutId,
      status: "pending",
      payload: {
        transactionId: recon.bankTxnId,
        fromAccountId: accounts.clearingId,
        toAccountId: accounts.bankId,
        amount: netDollars,
        date: recon.bankTxnDate ?? recon.arrivalDate,
        description: `Stripe payout ${recon.payoutId}`,
      },
    });
  }

  return out;
}

// ---- Proposal store + execution -------------------------------------------

export async function listProposals(): Promise<ReconProposal[]> {
  return (await kv.get<ReconProposal[]>(PROPOSALS_KEY)) ?? [];
}

export async function getLastRun(): Promise<ReconRun | null> {
  return (await kv.get<ReconRun>(LAST_RUN_KEY)) ?? null;
}

async function saveProposals(proposals: ReconProposal[]): Promise<void> {
  await kv.set(PROPOSALS_KEY, proposals);
}

/**
 * Post one approved proposal to Zoho Books.
 *
 * Every kind re-checks its idempotency guard immediately before writing, so a
 * double-click, a retry, or a concurrent run can't post the same entry twice —
 * the guard is a live Zoho lookup, not a local flag.
 */
export async function approveProposal(id: string): Promise<ReconProposal> {
  const proposals = await listProposals();
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`No proposal ${id}`);
  if (proposal.status === "approved") return proposal;

  try {
    proposal.postedId = await postProposal(proposal);
    proposal.status = "approved";
    proposal.error = undefined;
  } catch (err) {
    proposal.status = "failed";
    proposal.error = err instanceof Error ? err.message : String(err);
  }

  await saveProposals(proposals);
  return proposal;
}

async function postProposal(proposal: ReconProposal): Promise<string> {
  const p = proposal.payload;

  if (proposal.kind === "payment") {
    const reference = String(p.reference);
    const existing = await findCustomerPaymentByReference(reference);
    if (existing) return existing.payment_id; // already recorded — no-op

    const created = await createCustomerPayment({
      customerId: String(p.customerId),
      invoiceId: String(p.invoiceId),
      amount: Number(p.amount),
      date: String(p.date),
      accountId: String(p.accountId),
      reference,
      description: String(p.description ?? ""),
    });
    return created.payment_id;
  }

  if (proposal.kind === "fee") {
    const reference = String(p.reference);
    const existing = await findExpenseByReference(reference);
    if (existing) return existing.expense_id; // already posted — no-op

    const created = await createExpense({
      accountId: String(p.accountId),
      paidThroughAccountId: String(p.paidThroughAccountId),
      date: String(p.date),
      amount: Number(p.amount),
      taxId: p.taxId ? String(p.taxId) : undefined,
      reference,
      description: String(p.description ?? ""),
    });
    return created.expense_id;
  }

  // transfer — categorizing the feed line is itself the guard: Zoho rejects a
  // line that is no longer uncategorized.
  await categorizeTxnAsTransfer(String(p.transactionId), {
    from_account_id: String(p.fromAccountId),
    to_account_id: String(p.toAccountId),
    date: String(p.date),
    amount: Number(p.amount),
    description: String(p.description ?? ""),
  });
  return String(p.transactionId);
}

export async function rejectProposal(id: string): Promise<ReconProposal | null> {
  const proposals = await listProposals();
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) return null;
  proposal.status = "rejected";
  await saveProposals(proposals);
  return proposal;
}

/**
 * Approve every pending proposal of the given kinds, oldest first. Payments are
 * posted before payouts so clearing is funded before it's drawn down — the same
 * order the money actually moved.
 */
export async function approveAll(kinds?: ProposalKind[]): Promise<{
  approved: number;
  failed: number;
  results: ReconProposal[];
}> {
  const order: ProposalKind[] = ["payment", "fee", "transfer"];
  const want = new Set(kinds ?? order);

  const proposals = await listProposals();
  const pending = proposals
    .filter((p) => p.status === "pending" && want.has(p.kind))
    .sort(
      (a, b) =>
        order.indexOf(a.kind) - order.indexOf(b.kind) || a.date.localeCompare(b.date)
    );

  const results: ReconProposal[] = [];
  for (const proposal of pending) {
    try {
      proposal.postedId = await postProposal(proposal);
      proposal.status = "approved";
      proposal.error = undefined;
    } catch (err) {
      proposal.status = "failed";
      proposal.error = err instanceof Error ? err.message : String(err);
    }
    results.push(proposal);
  }

  await saveProposals(proposals);
  return {
    approved: results.filter((r) => r.status === "approved").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}

// ---- Penny's context ------------------------------------------------------

/**
 * A short Markdown block describing the current reconciliation state, for
 * injection into Penny's chat context so she can answer "where does Stripe
 * stand?" without a tool call.
 */
export async function renderStripeReconContext(): Promise<string> {
  if (!stripeConfigured()) {
    return "=== STRIPE RECONCILIATION ===\nNot configured (STRIPE_SECRET_KEY unset), so no Stripe reconciliation data is available.";
  }

  const run = await getLastRun().catch(() => null);
  if (!run) {
    return "=== STRIPE RECONCILIATION ===\nNo reconciliation has been run yet. Run one from /accounting/stripe.";
  }

  const pending = (await listProposals().catch(() => []))
    .filter((p) => p.status === "pending");

  const lines = [
    "=== STRIPE RECONCILIATION ===",
    `Last run ${run.generatedAt.slice(0, 10)}, covering ${run.windowDays} days back to ${run.since}.`,
    `${run.summary.payouts} payouts, ${run.summary.charges} card sales — gross $${run.summary.grossDollars.toFixed(2)}, fees $${run.summary.feeDollars.toFixed(2)}, net to bank $${run.summary.netDollars.toFixed(2)}.`,
    `${run.summary.settled} sales already settled cleanly; ${run.summary.paymentsMissing} invoices are still unpaid despite a successful card charge; ${run.summary.invoicesMissing} charges have no matching Zoho invoice at all.`,
    `${pending.length} proposed postings awaiting approval.`,
    "",
    "How card sales are supposed to post: invoice raised (Dr A/R, Cr Revenue+HST) → card paid (Dr Stripe Clearing, Cr A/R) → payout (Dr Chequing net, Dr Merchant Fees, Cr Stripe Clearing).",
    "Stripe Clearing should net to roughly zero once a payout settles. If it doesn't, a leg is missing — that is the check worth running weekly.",
  ];

  if (run.warnings.length > 0) {
    lines.push("", "Setup warnings: " + run.warnings.join(" | "));
  }

  return lines.join("\n");
}
