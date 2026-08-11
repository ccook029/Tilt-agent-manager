# Stripe reconciliation

Penny matches Stripe payouts and card sales against Zoho Books and proposes the
postings that are missing. Console: **`/accounting/stripe`**.

## The accounting

Every web sale has to post three times. Each leg does a distinct job, and the
whole design falls out of getting leg 2 right.

| # | Event | Entry |
|---|---|---|
| 1 | Invoice raised at checkout | `Dr A/R` · `Cr Revenue + HST` |
| 2 | Card paid | `Dr Stripe Clearing` · `Cr A/R` |
| 3 | Payout lands in the bank | `Dr Main Checking (net)` + `Dr Merchant Fees (+ITC)` · `Cr Stripe Clearing` |

**Leg 2 goes to clearing, never the bank.** The customer's money is real, but
Stripe is still holding it. Depositing straight to chequing double-counts as
soon as the payout arrives.

**Leg 3 is a transfer, never revenue.** Revenue was already recognized at leg 1.
Booking a payout as income is the most damaging error in processor
reconciliation, and the easiest one to make.

Leg 3 posts as two pieces rather than a journal entry:

1. A **fee expense paid through Stripe Clearing** — `Dr Merchant Fees` ·
   `Cr Stripe Clearing`
2. A **fund transfer of the net**, matched to the real bank feed line —
   `Dr Main Checking` · `Cr Stripe Clearing`

That way the bank line matches to the penny and nothing needs a hand-written
journal entry.

### The self-check

After a clean run, **Stripe Clearing should net to roughly zero**, holding only
money genuinely in transit. Debits (payments in) equal credits (fees + payouts
out). A clearing balance that drifts and never returns means a leg is missing —
that is the weekly check worth running, and the reason this console exists.

## The join key

tiltweb stamps the Stripe **PaymentIntent id** onto the Zoho invoice's
`reference_number` (`tiltweb src/lib/zoho-books.ts`), and writes
`tilt_invoice_id` / `tilt_invoice_number` back onto the PaymentIntent metadata
(`tiltweb src/lib/order-state.ts`). So the link is exact and bidirectional:

```
payout → balance_transaction → charge → payment_intent → reference_number → Zoho invoice
```

No fuzzy matching on email + amount + date anywhere in the reconciler. The
customer payment carries the same reference, which is also the idempotency
guard: if a payment with that reference exists, the leg is done.

## Why legs were missing

**Leg 2 exists in tiltweb but leaks.** `recordPayment()` does the right thing —
records the payment to Stripe Clearing, idempotent, correct reference. But every
call site swallows its errors:

```js
} catch (payErr) {
  // Non-critical — invoice exists, payment recording failed.
  console.warn("Could not record payment for invoice:", ...)
}
```

and a failed clearing-account lookup just `console.warn`s and returns. Failures
are invisible everywhere except the books, which is why unpaid invoices looked
like the payment leg had never been built at all.

> **Practical consequence:** an unpaid invoice with a successful Stripe charge
> is almost always this, not a customer who didn't pay. Check Stripe before
> chasing anyone for money.

**Leg 3 never existed.** Nothing decomposed a payout into net + fees, so
clearing never came back to zero.

Penny handles both: she repairs the leaked leg-2 payments and posts leg 3.
Fixing tiltweb's error handling would stop new leaks at the source, but isn't
required — Penny catches them either way.

## Safety

- **Stripe access is read-only.** `src/lib/stripe.ts` has no POST helper and
  should never get one. Penny reads what Stripe did and writes the consequences
  to Zoho. Pair it with a **restricted key** (`rk_…`) and the restriction is
  enforced twice — by the key and by the shape of the module.
- **Propose-only.** A run builds proposals and posts nothing. Each proposal
  shows its full double entry before you approve it.
- **Idempotent.** Every posting re-checks a live Zoho lookup on its
  `reference_number` immediately before writing, so a double-click, a retry, or
  a concurrent run can't post twice.
- **No invented ITCs.** Tax on Stripe's fee is claimed only when Stripe itemizes
  a `type: "tax"` line in its own fee breakdown. When it doesn't, the fee posts
  with no tax code — claiming an ITC that was never charged is worse than
  missing one.
- **Refunds, disputes and adjustments are never auto-posted.** They're real
  money but not plain sales, so they're surfaced for a human.

## Setup

1. **Stripe → Developers → API keys → Restricted key.** Grant *read* on
   Charges, Balance transactions, Payouts, Customers, Invoices. Set it as
   `STRIPE_SECRET_KEY` in the hub's Vercel env.
2. **Check the wiring before running anything:**
   `GET /api/accounting/stripe-recon?diagnose=1` — reports the key type
   (restricted vs full), live vs test, and which Zoho accounts it resolved. It
   posts nothing.
3. **Reconcile.** `/accounting/stripe` → *Reconcile* (defaults to 90 days).
4. **Review and post.** Approve individually, or post a whole group at once.
   Payments post before payouts so clearing is funded before it's drawn down —
   the same order the money actually moved.

### Env

| Var | Default | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | — | Restricted read-only key (`rk_…`) |
| `ZOHO_STRIPE_CLEARING_ACCOUNT` | `Stripe Clearing` | Already exists in Tilt's books |
| `ZOHO_MAIN_BANK_ACCOUNT` | `Main Checking Account` | |
| `ZOHO_STRIPE_FEE_ACCOUNT` | auto-detected | First account matching a known merchant-fee wording; the diagnose route reports the pick |
| `ZOHO_FEE_TAX_NAME` | org's HST code | Only applied when Stripe itemizes tax on the fee |

## Square

`Square Clearing` has the same gap for the same reason. The design here drops
onto Square unchanged — the only new work is a Square client and its own join
key, which is not the PaymentIntent id.
