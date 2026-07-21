/**
 * Tilt Hockey brand constants + hard guardrails (Section 3 of the spec).
 *
 * These are encoded as code-level guardrails so every downstream phase (vision
 * tagging, planning brain, copy, render briefs) imports the same source of
 * truth. The KB config table (Phase 2) layers editable detail on top, but the
 * NON-NEGOTIABLE rules below are not meant to be overridden at runtime.
 */

export const BRAND = {
  name: "Tilt Hockey",
  parent: "Tilt Sports Inc.",
  coreLine: "Don't be a sheep.",
  themes: [
    "Built for players",
    "Performance without the hype",
    "Stop overpaying for sticks",
    "Go Full Tilt",
  ],
  voice: [
    "confident",
    "authentic",
    "independent",
    "bold",
    "player-first",
    "locker-room",
    "never corporate",
  ],
  colors: {
    black: "#0D0D0D",
    // HARD RULE — this is the one true TILT cyan, `tilt-blue` (#00CFFF) in
    // the website's DESIGN_SYSTEM.md. Every accent, headline, and graphic
    // must use EXACTLY this hue. Never change it, and never let a model
    // substitute another blue. (#00BFFF previously lived here and shipped
    // off-brand graphics — do not regress.)
    cyan: "#00CFFF",
    darkGray: "#1A1A1A",
    midGray: "#333333",
  },
  fonts: {
    display: "Barlow Condensed", // Bold / SemiBold
    body: "Barlow",
  },
} as const;

/** Six content pillars — tag every post with one. */
export const PILLARS = [
  { id: 1, key: "proof", name: "Proof / Performance" },
  { id: 2, key: "sheep", name: "Don't-Be-A-Sheep" },
  { id: 3, key: "athletes", name: "Athletes / Ambassadors" },
  { id: 4, key: "product", name: "Product / Drops" },
  { id: 5, key: "community", name: "Community / Team & Tournaments" },
  { id: 6, key: "fit", name: "Fit / Education" },
] as const;

export type PillarId = (typeof PILLARS)[number]["id"];

/**
 * HARD RULES — never violate. Surfaced to the model in every prompt and used by
 * `assertSafeContent` to scrub generated output before it reaches a human.
 */
export const HARD_RULES = [
  "Logo is never rendered by an AI model — the TILT logo and team crests are composited by code as fixed PNG overlays.",
  `Brand color is exact — the ONLY accent color in any graphic or typeset text is TILT cyan ${BRAND.colors.cyan} (the website's tilt-blue), a bright electric ice-cyan. Never royal blue, navy, indigo, teal, or any other blue, and never a washed-out or darkened variant.`,
  "No competitor branding — always blur another manufacturer's logo or wordmark on the player's STICK or GLOVES (e.g. CCM, Bauer, Warrior, True); on the HELMET or PANTS blur it only when the mark is large and clearly readable, leaving subtle marks alone. Team jerseys, crests, and numbers are never touched.",
  "Real assets only — never AI-generate players, sticks, or hockey scenes; only edit/brand/format existing photos and clips.",
  "Never expose internal data — factory costs, margins, wholesale pricing, negotiation terms. Public MSRP and product names are fine.",
  "Tilt Hockey only — never reference Gaimchanger Golf or Tilt Baseball in Tilt Hockey content.",
  "MAP rule — online price = website price; never imply undercutting retailers.",
  "No earnings/income projections in any partner- or athlete-facing content.",
] as const;

/**
 * Terms that must never appear in any staff-visible or generated content.
 * Used as a coarse safety net; the model is also instructed to avoid these.
 */
const FORBIDDEN_TERMS = [
  "factory cost",
  "factory price",
  "margin",
  "markup",
  "wholesale price",
  "wholesale cost",
  "cost of goods",
  "cogs",
  "landed cost",
  "negotiation terms",
  "gaimchanger",
  "tilt baseball",
];

export type ContentSafetyResult = {
  safe: boolean;
  violations: string[];
};

/**
 * Coarse guardrail check for any text that will be shown to a user or published.
 * Not a substitute for the model-level instructions, but a cheap last line of
 * defense against the most damaging leaks (internal pricing, sibling brands).
 */
export function checkContentSafety(text: string): ContentSafetyResult {
  const haystack = text.toLowerCase();
  const violations = FORBIDDEN_TERMS.filter((term) => haystack.includes(term));
  return { safe: violations.length === 0, violations };
}
