// ---------------------------------------------------------------------------
// /api/inventory/item-groups — what Zoho actually built.
//
//   GET            → every item group in the org
//   GET ?id=<gid>  → one group with its attributes and variants
//
// Read-only. Exists because the create payload had to drop the `attributes`
// array to satisfy a Zoho validator, and "it returned 200" is not proof the
// variants hang off real attributes.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { fetchItemGroup, fetchItemGroups } from "@/lib/zoho";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  try {
    if (!id) {
      const groups = await fetchItemGroups();
      return NextResponse.json({ ok: true, count: groups.length, groups });
    }

    const group = await fetchItemGroup(id);
    const variants = group.items ?? [];
    return NextResponse.json({
      ok: true,
      groupId: group.group_id,
      groupName: group.group_name,
      attributes: [group.attribute_name1, group.attribute_name2].filter(Boolean),
      // If these come back empty the group is a bag of loose items, not a
      // real variant matrix — that's the thing worth knowing.
      variantsHaveOptions: variants.every((v) => !!v.attribute_option_name1),
      variantCount: variants.length,
      variants: variants.map((v) => ({
        sku: v.sku,
        name: v.name,
        option1: v.attribute_option_name1 ?? null,
        option2: v.attribute_option_name2 ?? null,
        stock: v.stock_on_hand ?? 0,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
