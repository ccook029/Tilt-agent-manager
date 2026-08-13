// ---------------------------------------------------------------------------
// /api/inventory/adjustments — the accounting trail for stock corrections.
//
// A quantity adjustment is not a bookkeeping no-op: Zoho posts it, moving
// Inventory Asset against an offset account. This shows what the cleanups
// actually wrote, plus the accounts available to send them to, so the offset
// is a decision rather than whatever Zoho defaults to.
//
//   GET → recent adjustments + candidate offset accounts + which one is set
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { fetchInventoryAdjustments } from "@/lib/zoho";
import { fetchChartOfAccounts, type BooksAccount } from "@/lib/zoho-books";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const configured = process.env.ZOHO_ADJUSTMENT_ACCOUNT_ID;

  const [adjustments, accounts] = await Promise.all([
    fetchInventoryAdjustments().catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    })),
    fetchChartOfAccounts().catch(() => ({ items: [] as BooksAccount[] })),
  ]);

  // Accounts an inventory adjustment could sensibly offset to. Listed rather
  // than chosen: picking an account out of someone else's chart of accounts
  // is not a call code should make.
  const candidates = ("items" in accounts ? accounts.items : [])
    .filter(
      (a) =>
        a.is_active &&
        /cost of goods|inventory|adjust|shrink|write.?off/i.test(a.account_name)
    )
    .map((a) => ({
      accountId: a.account_id,
      name: a.account_name,
      type: a.account_type,
      isConfigured: a.account_id === configured,
    }));

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
    candidateAccounts: candidates,
    adjustments: "error" in adjustments ? [] : adjustments,
    adjustmentsError: "error" in adjustments ? adjustments.error : undefined,
  });
}
