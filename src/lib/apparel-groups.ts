// ---------------------------------------------------------------------------
// apparel-groups.ts — build Zoho item groups for apparel from the storefront's
// own option lists.
//
// One Zoho item group per product, with Colour × Size attributes, so the
// catalog shows "Tilt Cotton Blend Hoodie" expandable to its variants instead
// of N flat SKUs. Variant SKUs come from apparel-skus.ts, the same rule the
// storefront uses at checkout, so a sale matches the stock it should decrement.
//
// Pilot scope: the two hoodies. The shape generalizes to the rest of apparel
// once the pattern is proven against live Zoho.
// ---------------------------------------------------------------------------
import { createItemGroup, type CreateItemGroupInput } from "./zoho";
import { apparelSku } from "./apparel-skus";

export interface ApparelProductDef {
  /** Storefront product id — the join back to the site catalog. */
  productId: string;
  groupName: string;
  description: string;
  price: number;
  colours: string[];
  sizes: string[];
}

/**
 * Mirrors src/data/products.ts in tiltweb. Kept explicit rather than fetched:
 * this runs once per product to create permanent Zoho records, and a silent
 * drift in options would mint variants that don't match anything sellable.
 */
export const APPAREL_PILOT: ApparelProductDef[] = [
  {
    productId: "tilt-cotton-hoodie",
    groupName: "Tilt Cotton Blend Hoodie",
    description: "Premium fleece-lined hoodie with athletic fit and Tilt Hockey branding.",
    price: 64.99,
    colours: ["Grey", "Black"],
    sizes: ["YS", "YM", "YL", "S", "M", "L", "XL", "XXL"],
  },
  {
    productId: "tilt-custom-hoodie",
    groupName: "Tilt Performance Tech Hoodie",
    description: "Performance cotton/poly blend hoodie with a modern athletic fit.",
    price: 74.99,
    colours: ["Black", "Grey", "Navy"],
    sizes: ["S", "M", "L", "XL", "XXL"],
  },
];

export interface PlannedVariant {
  sku: string;
  name: string;
  colour: string;
  size: string;
  rate: number;
}

export interface PlannedGroup {
  productId: string;
  groupName: string;
  attributes: { name: string; options: string[] }[];
  variants: PlannedVariant[];
  /** Anything that can't be built — an unmapped product, a colour that
   *  produced no code. Non-empty means do not create this group. */
  problems: string[];
}

/** Work out exactly what would be created, without calling Zoho. */
export function planApparelGroups(
  defs: ApparelProductDef[] = APPAREL_PILOT
): PlannedGroup[] {
  return defs.map((def) => {
    const variants: PlannedVariant[] = [];
    const problems: string[] = [];
    const seen = new Set<string>();

    for (const colour of def.colours) {
      for (const size of def.sizes) {
        const sku = apparelSku(def.productId, colour, size);
        if (!sku) {
          problems.push(
            `No SKU for ${colour} / ${size} — product id "${def.productId}" is not in APPAREL_PRODUCT_CODES, or the colour/size is blank.`
          );
          continue;
        }
        if (seen.has(sku)) {
          problems.push(`Duplicate SKU ${sku} — two colour/size combinations collide.`);
          continue;
        }
        seen.add(sku);
        variants.push({
          sku,
          name: `${def.groupName} - ${colour} - ${size}`,
          colour,
          size,
          rate: def.price,
        });
      }
    }

    return {
      productId: def.productId,
      groupName: def.groupName,
      // "Color" to match the storefront's own option key. Zoho can't rename
      // an attribute after the group exists, so this is fixed from here.
      attributes: [
        { name: "Color", options: def.colours },
        { name: "Size", options: def.sizes },
      ],
      variants,
      problems,
    };
  });
}

export interface CreateGroupResult {
  productId: string;
  groupName: string;
  created: boolean;
  groupId?: string;
  variantCount: number;
  error?: string;
}

/**
 * Create the planned groups in Zoho. Every variant starts at zero stock —
 * the catalog is being rebuilt precisely because the old counts weren't
 * trustworthy, so nothing is carried over.
 *
 * A group with problems in its plan is refused outright: a partially-correct
 * group is worse than none, since Zoho won't let it be restructured after the
 * fact.
 */
export async function createApparelGroups(
  productIds: string[]
): Promise<CreateGroupResult[]> {
  const plans = planApparelGroups().filter((p) => productIds.includes(p.productId));
  const results: CreateGroupResult[] = [];

  for (const plan of plans) {
    if (plan.problems.length > 0) {
      results.push({
        productId: plan.productId,
        groupName: plan.groupName,
        created: false,
        variantCount: plan.variants.length,
        error: `Refused — ${plan.problems.join(" ")}`,
      });
      continue;
    }

    const input: CreateItemGroupInput = {
      group_name: plan.groupName,
      description: APPAREL_PILOT.find((d) => d.productId === plan.productId)?.description,
      attributes: plan.attributes,
      variants: plan.variants.map((v) => ({
        name: v.name,
        sku: v.sku,
        rate: v.rate,
        attribute_option_name1: v.colour,
        attribute_option_name2: v.size,
        initial_stock: 0,
      })),
    };

    try {
      const group = await createItemGroup(input);
      results.push({
        productId: plan.productId,
        groupName: plan.groupName,
        created: true,
        groupId: group.group_id,
        variantCount: plan.variants.length,
      });
    } catch (err) {
      results.push({
        productId: plan.productId,
        groupName: plan.groupName,
        created: false,
        variantCount: plan.variants.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
