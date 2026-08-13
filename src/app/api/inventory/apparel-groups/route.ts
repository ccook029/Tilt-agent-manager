// ---------------------------------------------------------------------------
// /api/inventory/apparel-groups — build Zoho item groups for apparel.
//
//   GET  → the full plan (dry run, writes nothing)
//   POST { productIds } → create those groups in Zoho
//
// Creation is one-way: Zoho can't restructure a group afterwards, so the GET
// plan is the thing to check before posting.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { planApparelGroups, createApparelGroups } from "@/lib/apparel-groups";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const plan = planApparelGroups();
  return NextResponse.json({
    ok: true,
    groups: plan.length,
    totalVariants: plan.reduce((s, p) => s + p.variants.length, 0),
    hasProblems: plan.some((p) => p.problems.length > 0),
    plan,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const productIds = (body as { productIds?: unknown }).productIds;
  if (
    !Array.isArray(productIds) ||
    productIds.length === 0 ||
    !productIds.every((p) => typeof p === "string")
  ) {
    return NextResponse.json(
      { ok: false, error: "Pass productIds: a non-empty array of storefront product ids." },
      { status: 400 }
    );
  }

  try {
    const results = await createApparelGroups(productIds);
    const created = results.filter((r) => r.created);
    if (created.length > 0) {
      await postSignal({
        source: "inventory",
        headline: `Created ${created.length} apparel item group${created.length === 1 ? "" : "s"} in Zoho`,
        detail: created
          .map((r) => `${r.groupName} — ${r.variantCount} variants, stock starting at 0`)
          .join("\n"),
      }).catch(() => {});
    }
    return NextResponse.json({
      ok: true,
      created: created.length,
      failed: results.length - created.length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
