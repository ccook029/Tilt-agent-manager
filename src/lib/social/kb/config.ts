import { db } from "@/lib/social/db";
import { kbConfig } from "@/lib/social/db/schema";
import { eq } from "drizzle-orm";
import { isDemoMode } from "@/lib/social/demo-data";
import { BRAND, PILLARS } from "@/lib/social/brand";

/**
 * KB config (Phase 2) — versioned, EDITABLE brand/product/calendar/voice config
 * that drives the planning brain. The default below is the seed; the active row
 * in `kb_config` overrides it once edited. Nothing here is internal/sensitive —
 * public MSRP and product names only (prices left blank to be filled in, never
 * fabricated).
 */

export type Product = {
  name: string;
  category: "stick" | "goalie" | "apparel" | "accessory";
  /** Public MSRP as a display string, e.g. "$279.99". Blank = don't state a price. */
  msrp: string;
  notes: string;
};

export type CalendarEvent = {
  label: string;
  /** ISO date or a loose month marker like "2026-06" for multi-week windows. */
  date: string;
  pillar: number;
  note: string;
};

export type KbConfig = {
  version: string;
  voice: {
    coreLine: string;
    traits: string[];
    themes: string[];
    avoid: string[];
  };
  pillars: { id: number; key: string; name: string; weight: number }[];
  cadence: {
    instagramPerWeek: number;
    tiktokPerWeek: number;
    facebookPerWeek: number;
    priorityFormat: string;
  };
  products: Product[];
  competitors: string[];
  hashtags: { core: string[]; byPillar: Record<string, string[]> };
  ctas: string[];
  calendar: CalendarEvent[];
};

export const DEFAULT_KB: KbConfig = {
  version: "2026.06-default",
  voice: {
    coreLine: BRAND.coreLine,
    traits: [...BRAND.voice],
    themes: [...BRAND.themes],
    avoid: [
      "corporate / salesy tone",
      "hype words like 'revolutionary', 'game-changing'",
      "undercutting-retailers language (respect MAP)",
      "earnings or income claims",
      "any mention of Gaimchanger Golf or Tilt Baseball",
      "internal costs, margins, wholesale pricing",
    ],
  },
  pillars: PILLARS.map((p) => ({
    ...p,
    // Weekly emphasis — higher weight => more slots. Tunable.
    weight: { proof: 3, sheep: 3, athletes: 2, product: 3, community: 2, fit: 2 }[
      p.key
    ] ?? 2,
  })),
  cadence: {
    instagramPerWeek: 5,
    tiktokPerWeek: 4,
    facebookPerWeek: 3,
    priorityFormat: "short video (reel)",
  },
  products: [
    { name: "X1 Player Stick", category: "stick", msrp: "", notes: "Flagship pro-level carbon stick; custom curve/flex/kick/length." },
    { name: "X1 Goalie Stick", category: "goalie", msrp: "", notes: "Pro-level goalie stick." },
    { name: "Tilt Apparel", category: "apparel", msrp: "", notes: "Hoodies, tees, headwear." },
    { name: "Accessories", category: "accessory", msrp: "", notes: "Grip, mini sticks, tape." },
  ],
  competitors: ["Bauer", "CCM", "Warrior"],
  hashtags: {
    core: ["#TiltHockey", "#DontBeASheep", "#GoFullTilt", "#BuiltForPlayers"],
    byPillar: {
      proof: ["#ShotSpeed", "#ProvenOnIce", "#StickCheck"],
      sheep: ["#StopOverpaying", "#ChallengerBrand", "#KnowYourWorth"],
      athletes: ["#TiltAmbassador", "#TeamTilt"],
      product: ["#X1", "#NewDrop", "#CustomStick"],
      community: ["#GrassrootsHockey", "#TiltEliteProspects", "#HockeyFamily"],
      fit: ["#TiltGenius", "#FlexAndCurve", "#StickFit"],
    },
  },
  ctas: [
    "Build yours at tilthockey.com",
    "Customize your stick — link in bio",
    "Drop a 🏒 if you're switching",
    "Tag a teammate who needs to see this",
    "Shop the drop — link in bio",
  ],
  calendar: [
    { label: "Tilt Elite Prospects (TEP)", date: "2026-06", pillar: 5, note: "June tournament, Durham Region — grassroots showcase." },
    { label: "Summer training ramp", date: "2026-07", pillar: 1, note: "Off-season skill + proof content." },
    { label: "Preseason ramp", date: "2026-08", pillar: 4, note: "Back-to-hockey, gear-up messaging." },
    { label: "Tryouts season", date: "2026-09", pillar: 6, note: "Fit/education: flex, curve, length picks." },
    { label: "Season opener", date: "2026-10", pillar: 3, note: "Ambassadors + teams back on ice." },
  ],
};

/** Returns the active KB config (DB override if present, else the default). */
export async function getActiveKbConfig(): Promise<KbConfig> {
  if (isDemoMode()) return DEFAULT_KB;
  try {
    const rows = await db
      .select()
      .from(kbConfig)
      .where(eq(kbConfig.active, "true"))
      .limit(1);
    const cfg = rows[0]?.config as KbConfig | undefined;
    return cfg ?? DEFAULT_KB;
  } catch {
    return DEFAULT_KB;
  }
}
