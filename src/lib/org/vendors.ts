// ---------------------------------------------------------------------------
// org/vendors.ts — Tilt's manufacturing vendors and how we order from each.
//
// The Team Sales Coordinator routes every line of a team order to the right
// factory and drafts the purchase email in Jeremy's voice. This registry is
// the source of truth for WHO makes WHAT and the ordering quirks that must
// survive into the email. Learned from the Lucan Irish order (June–July 2026).
//
// Teach it a new vendor: add an entry here (and, if it's a whole new product
// category, map the category to it). Unknown/unspecified categories fall back
// to Tack, and the coordinator flags the assumption for Chris/Jeremy.
// ---------------------------------------------------------------------------

export interface Vendor {
  id: string;
  company: string;
  contactName: string;
  /** Primary recipient first; any extras are Cc'd (e.g. Tony on gloves). */
  contactEmails: string[];
  location?: string;
  /** Product categories this vendor manufactures. */
  categories: string[];
  /** Ordering specifics that must be respected and reflected in the email. */
  notes: string;
}

/** The default vendor when a category isn't otherwise mapped (Chris's rule). */
export const DEFAULT_VENDOR_ID = "tack";

export const VENDORS: Record<string, Vendor> = {
  tack: {
    id: "tack",
    company: "Tack Enterprises",
    contactName: "Adeem",
    contactEmails: ["info@tackent.com"],
    categories: [
      "jerseys",
      "socks",
      "pant-shells",
      "bags",
      "t-shirts",
      "practice-jerseys",
      "apparel", // catch-all soft goods
    ],
    notes:
      "Primary soft-goods factory. Pro cut-and-sew, full sublimation, twill + embroidery. Wants to see mockups before printing on shirt/sublimation jobs. Applies TILT garment tags and TILT branding in the usual spots. Sea shipping to manage cost. This is the DEFAULT vendor for any apparel category not otherwise specified.",
  },
  citipro: {
    id: "citipro",
    company: "Citi-Pro",
    contactName: "Joey",
    contactEmails: ["gz04@citi-pro.com", "tonyhuang31@hotmail.com"], // Tony cc'd
    location: "China",
    categories: ["gloves"],
    notes:
      "Hockey gloves. Address to Joey and cc Tony. Known options to reference when relevant: K531 material (thicker/more durable), TPU cuff logo, reinforced palm. Sea shipping, ~7–8 week lead. Confirm pantone match (team green is 567C).",
  },
  weightsw: {
    id: "weightsw",
    company: "Weight Sports Wear",
    contactName: "Afshan Butt",
    contactEmails: ["info@weightsw.com"],
    location: "Pakistan",
    categories: ["track-suits", "jackets"],
    notes:
      "Track suits and jackets. Full embroidery; full TILT branding inside the jacket as done previously. Sea shipping to manage cost.",
  },
};

/** Normalize a free-form product label to a known category slug. */
export function normalizeCategory(raw: string): string {
  const t = raw.toLowerCase().trim();
  if (/glove/.test(t)) return "gloves";
  if (/track\s*suit|tracksuit/.test(t)) return "track-suits";
  if (/jacket/.test(t)) return "jackets";
  if (/practice\s*jersey/.test(t)) return "practice-jerseys";
  if (/jersey/.test(t)) return "jerseys";
  if (/sock/.test(t)) return "socks";
  if (/pant\s*shell|pant/.test(t)) return "pant-shells";
  if (/bag/.test(t)) return "bags";
  if (/t-?shirt|tee|shirt/.test(t)) return "t-shirts";
  return t;
}

/** The vendor that makes a product category, falling back to the default. */
export function resolveVendor(category: string): {
  vendor: Vendor;
  isDefault: boolean;
} {
  const cat = normalizeCategory(category);
  const match = Object.values(VENDORS).find((v) => v.categories.includes(cat));
  if (match) return { vendor: match, isDefault: false };
  return { vendor: VENDORS[DEFAULT_VENDOR_ID], isDefault: true };
}

/** Shared ordering conventions every vendor email follows (Jeremy's pattern). */
export const ORDER_CONVENTIONS = `HOW TILT ORDERS FROM VENDORS (follow every point):
- Always Cc chris@tilthockey.com AND jeremy@tilthockey.com on every vendor email.
- Break the order out by size with clear quantities and a total, exactly as given in the team order.
- Team green is Pantone 567C unless the order says otherwise. State pantones explicitly.
- Use the team's crest/logo as specified in the order (e.g. the IRISH clover); TILT branding goes "in the usual spots" plus the TILT garment tag.
- Prefer SEA shipping to manage cost, and state the target delivery window.
- Keep the tone warm, direct, and specific — a spec the factory can build from without follow-up. Always invite clarification.
- ONE email per product per vendor (matching how Jeremy sends them), not one giant combined email.`;

/** The signature block that closes every vendor email. */
export const VENDOR_EMAIL_SIGNATURE = `Jeremy Elliott
Co-Founder
Email: jeremy@tilthockey.com
www.tilthockey.com`;

/** Render the whole vendor registry for injection into the coordinator's prompt. */
export function renderVendorRegistry(): string {
  const lines = Object.values(VENDORS).map((v) => {
    const emails = `${v.contactEmails[0]}${
      v.contactEmails.length > 1 ? ` (cc ${v.contactEmails.slice(1).join(", ")})` : ""
    }`;
    return `- ${v.company} — contact ${v.contactName} <${emails}>${
      v.location ? ` [${v.location}]` : ""
    }\n  Makes: ${v.categories.join(", ")}\n  Notes: ${v.notes}`;
  });
  return [
    "=== TILT VENDOR REGISTRY (who makes what — route every line here) ===",
    lines.join("\n"),
    `\nDefault vendor when a category is unknown/unspecified: ${VENDORS[DEFAULT_VENDOR_ID].company} (${VENDORS[DEFAULT_VENDOR_ID].contactName}). When you fall back to the default, SAY SO and raise it as a decision request so Chris/Jeremy can confirm.`,
    "",
    ORDER_CONVENTIONS,
    "=== END VENDOR REGISTRY ===",
  ].join("\n");
}
