// ---------------------------------------------------------------------------
// /api/inventory/adjustments — the accounting trail for stock corrections.
//
// A quantity adjustment is not a bookkeeping no-op: Zoho posts it, moving
// Inventory Asset against an offset account. This shows what the cleanups
// actually wrote, plus the accounts available to send them to, so the offset
// is a decision rather than whatever Zoho defaults to.
//
//   GET            → recent adjustments + candidate offset accounts
//   GET ?id=<adjId> → one adjustment in full, including the account it hit
//
// The list response carries no account, so ?id= is the only way to answer
// "where did this post?".
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { fetchInventoryAdjustments, fetchInventoryAdjustment } from "@/lib/zoho";
import { fetchChartOfAccounts, type BooksAccount } from "@/lib/zoho-books";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Accounts an inventory adjustment could plausibly offset to. */
const LIKELY = /cost of goods|inventory|adjust|shrink|write.?off|cogs|damage|obsole/i;

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    try {
      const adjustment = await fetchInventoryAdjustment(id);
      return NextResponse.json({ ok: true, adjustment });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 502 }
      );
    }
  }

  const configured = process.env.ZOHO_ADJUSTMENT_ACCOUNT_ID;

  const [adjustments, accounts] = await Promise.all([
    fetchInventoryAdjustments().catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    })),
    // Report the failure instead of swallowing it — an empty account list read
    // as "no matching accounts" when it may have been "the call failed", and
    // those need different responses.
    fetchChartOfAccounts()
      .then((items) => ({ items, error: undefined as string | undefined }))
      .catch((err) => ({
        items: [] as BooksAccount[],
        error: err instanceof Error ? err.message : String(err),
      })),
  ]);

  const all: BooksAccount[] = accounts.items ?? [];
  const active = all.filter((a) => a.is_active);

  return NextResponse.json({
    ok: true,
    offsetAccount: configured
      ? { accountId: configured, source: "ZOHO_ADJUSTMENT_ACCOUNT_ID" }
      : {
          accountId: null,
          source: "Zoho default",
          warning:
            "No offset account is set, so Zoho posts these to its own default — commonly Cost of Goods Sold, which puts inventory clean-up in the P&L. Set ZOHO_ADJUSTMENT_ACCOUNT_ID to choose deliberately.",
        },
    accountsError: accounts.error,
    accountsFound: all.length,
    // Both lists, because a filter that finds nothing tells you less than the
    // full set does.
    likelyAccounts: active
      .filter((a) => LIKELY.test(a.account_name))
      .map((a) => ({ accountId: a.account_id, name: a.account_name, type: a.account_type })),
    allExpenseOrCogsAccounts: active
      .filter((a) => /expense|cost_of_goods|cogs/i.test(a.account_type))
      .map((a) => ({ accountId: a.account_id, name: a.account_name, type: a.account_type })),
    adjustments: "error" in adjustments ? [] : adjustments,
    adjustmentsError: "error" in adjustments ? adjustments.error : undefined,
  });
}
