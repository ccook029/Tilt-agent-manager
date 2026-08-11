// ---------------------------------------------------------------------------
// stripe.ts — READ-ONLY Stripe client for Penny's reconciliation.
//
// Deliberately GET-only. There is no post()/delete() helper in this file and
// there should never be one: Penny reads what Stripe already did and writes the
// consequences to Zoho Books. She must never be able to move money in Stripe,
// refund a charge, or edit a payout. Pair this with a RESTRICTED Stripe key
// (rk_...) that has read permission on Charges, Balance transactions, Payouts,
// Customers and Invoices — then the restriction is enforced twice: once by the
// key, once by the shape of this module.
//
// Plain fetch rather than the `stripe` npm package — one less dependency, and
// the GET-only surface is the point.
//
// Env: STRIPE_SECRET_KEY
// ---------------------------------------------------------------------------

const STRIPE_API = "https://api.stripe.com/v1";

/** Stripe API version this client is written against. Pinned so a Stripe-side
 *  upgrade can't silently change field shapes underneath the reconciler. */
const STRIPE_VERSION = "2024-06-20";

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Describes the configured key WITHOUT ever revealing it. Used by the diagnose
 * route so you can confirm at a glance that the hub is holding a restricted,
 * live, read-only key rather than a full-access secret key.
 */
export function describeStripeKey(): {
  configured: boolean;
  restricted: boolean;
  livemode: boolean;
  hint: string;
} {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) {
    return { configured: false, restricted: false, livemode: false, hint: "" };
  }
  return {
    configured: true,
    // rk_ = restricted key (scoped permissions). sk_ = full secret key.
    restricted: key.startsWith("rk_"),
    livemode: key.includes("_live_"),
    // Last 4 only — enough to tell two keys apart, useless if leaked.
    hint: `…${key.slice(-4)}`,
  };
}

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set — add a restricted (read-only) Stripe key " +
        "to the hub's environment before running reconciliation."
    );
  }
  return key;
}

/**
 * Flatten a nested params object into Stripe's bracket form, e.g.
 * { created: { gte: 123 } } → "created[gte]=123", { expand: ["a"] } → "expand[]=a".
 */
type ParamValue = string | number | boolean | undefined | ParamValue[] | { [k: string]: ParamValue };

function encodeParams(params: Record<string, ParamValue>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [rawKey, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const key = prefix ? `${prefix}[${rawKey}]` : rawKey;
    if (Array.isArray(value)) {
      for (const v of value) {
        out.push(`${encodeURIComponent(`${key}[]`)}=${encodeURIComponent(String(v))}`);
      }
    } else if (value !== null && typeof value === "object") {
      out.push(...encodeParams(value as Record<string, ParamValue>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

async function stripeGet<T>(
  path: string,
  params: Record<string, ParamValue> = {}
): Promise<T> {
  const qs = encodeParams(params).join("&");
  const url = `${STRIPE_API}${path}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      "Stripe-Version": STRIPE_VERSION,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    // A restricted key missing a permission returns 403 with a clear message —
    // surface it verbatim so the fix ("add read on Balance transactions") is
    // obvious rather than buried.
    throw new Error(`Stripe GET ${path} failed (${res.status}): ${body.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

interface StripeList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

/**
 * Walk a Stripe list endpoint with cursor pagination, up to `max` records.
 * `max` is a hard stop so a wide date window can never spin forever inside a
 * serverless function.
 */
async function stripeList<T extends { id: string }>(
  path: string,
  params: Record<string, ParamValue> = {},
  max = 1000
): Promise<T[]> {
  const out: T[] = [];
  let startingAfter: string | undefined;

  while (out.length < max) {
    const page = await stripeGet<StripeList<T>>(path, {
      ...params,
      limit: Math.min(100, max - out.length),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    out.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return out;
}

// ---- Types (partial — only the fields reconciliation actually reads) -------

export interface StripePayout {
  id: string;
  object: "payout";
  /** NET amount deposited to the bank, in cents. */
  amount: number;
  currency: string;
  /** Unix seconds — the day the money lands in the bank. Match the bank feed
   *  line on THIS, not on `created`. */
  arrival_date: number;
  created: number;
  status: string; // paid | pending | in_transit | canceled | failed
  description?: string | null;
  statement_descriptor?: string | null;
}

export interface StripeCharge {
  id: string;
  object: "charge";
  amount: number;
  currency: string;
  paid: boolean;
  refunded: boolean;
  created: number;
  payment_intent?: string | null;
  receipt_email?: string | null;
  billing_details?: { email?: string | null; name?: string | null } | null;
  metadata?: Record<string, string>;
}

export interface StripeBalanceTransaction {
  id: string;
  object: "balance_transaction";
  /** GROSS amount in cents (before Stripe's cut). Negative for refunds/payouts. */
  amount: number;
  /** Stripe's fee in cents. */
  fee: number;
  /** amount - fee. */
  net: number;
  currency: string;
  created: number;
  /** available_on is when it becomes payout-eligible. */
  available_on: number;
  /** Itemized breakdown of `fee`. Canadian merchants get a `type: "tax"` line
   *  when Stripe charges GST/HST on its fee — that is the exact ITC amount, so
   *  we split on it rather than guessing a tax-inclusive rate. */
  fee_details?: Array<{
    amount: number;
    currency: string;
    type: string; // stripe_fee | tax | application_fee | ...
    description?: string | null;
  }>;
  /** charge | refund | payout | adjustment | stripe_fee | payment | ... */
  type: string;
  reporting_category?: string;
  description?: string | null;
  /** The source object id (e.g. ch_...), or the expanded object when
   *  `expand: ["data.source"]` was requested. */
  source: string | StripeCharge | null;
}

// ---- Reads ----------------------------------------------------------------

/** Payouts created on/after `sinceUnix`. Most recent first. */
export async function fetchPayouts(
  sinceUnix: number,
  max = 200
): Promise<StripePayout[]> {
  return stripeList<StripePayout>("/payouts", { created: { gte: sinceUnix } }, max);
}

/**
 * Every balance transaction that makes up a payout, with the underlying charge
 * expanded in the same round trip. This is the decomposition that turns one
 * bank deposit back into the individual sales it settled.
 *
 * Note: Stripe includes the payout's OWN transaction (type "payout") in this
 * list. Callers should filter it out — see `isPayoutSelf`.
 */
export async function fetchPayoutTransactions(
  payoutId: string,
  max = 1000
): Promise<StripeBalanceTransaction[]> {
  return stripeList<StripeBalanceTransaction>(
    "/balance_transactions",
    { payout: payoutId, expand: ["data.source"] },
    max
  );
}

/** True for the balance transaction representing the payout itself (the money
 *  leaving the Stripe balance), as opposed to the sales that funded it. */
export function isPayoutSelf(txn: StripeBalanceTransaction): boolean {
  return txn.type === "payout";
}

/**
 * Resolve a balance transaction's source to a charge object when it is one.
 * Returns null for refunds, adjustments, Stripe fees, and the payout itself.
 */
export function chargeFromTxn(
  txn: StripeBalanceTransaction
): StripeCharge | null {
  const src = txn.source;
  if (!src || typeof src === "string") return null;
  if (src.object !== "charge") return null;
  return src;
}

/**
 * The Zoho invoice key carried on a charge. tiltweb writes the PaymentIntent id
 * into the Zoho invoice's `reference_number`, so the PI id IS the join key.
 * Falls back to the charge id for the rare charge created without a PI.
 */
export function invoiceRefForCharge(charge: StripeCharge): string {
  return charge.payment_intent || charge.id;
}

/**
 * The invoice tiltweb recorded back onto the PaymentIntent metadata, when
 * present. This is the reverse direction of the same link and lets us report a
 * human-readable invoice number without a second Zoho lookup.
 */
export function invoiceHintFromCharge(charge: StripeCharge): {
  invoiceId?: string;
  invoiceNumber?: string;
} {
  const meta = charge.metadata ?? {};
  return {
    invoiceId: meta.tilt_invoice_id || undefined,
    invoiceNumber: meta.tilt_invoice_number || undefined,
  };
}

/** Cents → dollars, rounded to the cent. */
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** Unix seconds → YYYY-MM-DD, the date form Zoho Books expects. */
export function unixToDate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}
