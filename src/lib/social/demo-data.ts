import type { Asset } from "./db/schema";
import { hasDatabase } from "./env";

/**
 * Built-in demo catalog. When DATABASE_URL is not configured the app runs in
 * "demo mode" and the UI reads from this list instead of Postgres — so the
 * whole front-end can be deployed and clicked through with zero backend setup
 * (no WorkDrive / Claude / Blob / database needed).
 *
 * The real Phase 1 pipeline (catalog:sync) replaces this with the live library.
 */

export function isDemoMode(): boolean {
  return !hasDatabase();
}

type DemoSeed = {
  filename: string;
  type: "photo" | "video";
  thumb: string;
  path: string;
  tags: Asset["tags"];
  suitable: string[];
};

export const DEMO_SEEDS: DemoSeed[] = [
  {
    filename: "x1-player-stick-studio-01.jpg",
    type: "photo",
    thumb: "/demo/product-cyan.svg",
    path: "X1 STICKS/x1-player-stick-studio-01.jpg",
    tags: {
      product: "X1 player stick",
      action: "static",
      setting: "studio",
      orientation: "portrait",
      description: "Clean studio hero of the X1 player stick on black.",
      keywords: ["product", "stick", "studio", "x1"],
      pillars: [4, 1],
    },
    suitable: ["static", "carousel"],
  },
  {
    filename: "x1-goalie-stick-studio-02.jpg",
    type: "photo",
    thumb: "/demo/product-dark.svg",
    path: "X1 STICKS/x1-goalie-stick-studio-02.jpg",
    tags: {
      product: "X1 goalie stick",
      action: "static",
      setting: "studio",
      orientation: "portrait",
      description: "Studio shot of the X1 goalie stick paddle + blade.",
      keywords: ["product", "goalie", "studio"],
      pillars: [4],
    },
    suitable: ["static"],
  },
  {
    filename: "prust-bench-rink-07.jpg",
    type: "photo",
    thumb: "/demo/athlete-cyan.svg",
    path: "AMBASSADORS/prust-bench-rink-07.jpg",
    tags: {
      person: "Brandon Prust",
      action: "static",
      setting: "rink",
      orientation: "landscape",
      description: "Prust on the bench, Tilt stick in hand, game-day light.",
      keywords: ["ambassador", "rink", "bench"],
      pillars: [3, 1],
    },
    suitable: ["static", "reel-cover"],
  },
  {
    filename: "schremp-shooting-action-11.jpg",
    type: "photo",
    thumb: "/demo/action-dark.svg",
    path: "AMBASSADORS/schremp-shooting-action-11.jpg",
    tags: {
      person: "Rob Schremp",
      action: "action",
      setting: "rink",
      orientation: "landscape",
      description: "Schremp mid-slapshot, flex loaded — proof shot.",
      keywords: ["action", "shot", "flex", "proof"],
      pillars: [1, 3],
    },
    suitable: ["reel-cover", "static"],
  },
  {
    filename: "komoka-kings-team-line-03.jpg",
    type: "photo",
    thumb: "/demo/team-cyan.svg",
    path: "TEAMS/komoka-kings-team-line-03.jpg",
    tags: {
      person: "Komoka Kings",
      action: "static",
      setting: "rink",
      orientation: "landscape",
      description: "Komoka Kings lined up on the blue line in Tilt gear.",
      keywords: ["team", "grassroots", "kings"],
      pillars: [5, 3],
    },
    suitable: ["carousel", "static"],
  },
  {
    filename: "hoodie-apparel-flatlay-05.jpg",
    type: "photo",
    thumb: "/demo/product-dark.svg",
    path: "APPAREL/hoodie-apparel-flatlay-05.jpg",
    tags: {
      product: "Tilt hoodie",
      action: "static",
      setting: "studio",
      orientation: "square",
      description: "Flatlay of the black Tilt hoodie with cyan mark.",
      keywords: ["apparel", "hoodie", "flatlay"],
      pillars: [4],
    },
    suitable: ["static", "carousel"],
  },
  {
    filename: "flex-curve-education-09.jpg",
    type: "photo",
    thumb: "/demo/action-cyan.svg",
    path: "EDUCATION/flex-curve-education-09.jpg",
    tags: {
      product: "X1 player stick",
      action: "static",
      setting: "studio",
      orientation: "landscape",
      description: "Close-up of blade curve + flex callouts for fit content.",
      keywords: ["fit", "flex", "curve", "education"],
      pillars: [6, 4],
    },
    suitable: ["carousel", "static"],
  },
  {
    filename: "vs-bauer-ccm-price-02.jpg",
    type: "photo",
    thumb: "/demo/athlete-dark.svg",
    path: "CAMPAIGN/vs-bauer-ccm-price-02.jpg",
    tags: {
      action: "static",
      setting: "studio",
      orientation: "portrait",
      description: "Side-by-side stick comparison set up for value messaging.",
      keywords: ["challenger", "value", "comparison"],
      pillars: [2, 1],
    },
    suitable: ["static", "reel-cover"],
  },
  {
    filename: "PRUST NICHOLS SCHREMP X TILT.mp4",
    type: "video",
    thumb: "",
    path: "PRUST NICHOLS SCHREMP X TILT.mp4",
    tags: {
      person: "Prust, Nichols, Schremp",
      action: "action",
      description: "Ambassador feature video (root library clip).",
      keywords: ["video", "ambassador"],
      pillars: [3],
    },
    suitable: ["reel", "manual-edit"],
  },
  {
    filename: "HALEY X TILT.mp4",
    type: "video",
    thumb: "",
    path: "HALEY X TILT.mp4",
    tags: {
      person: "Haley",
      action: "action",
      description: "Player feature video (root library clip).",
      keywords: ["video", "player"],
      pillars: [3],
    },
    suitable: ["reel", "manual-edit"],
  },
];

/** Demo seeds as fully-formed Asset rows for the read models. */
export function getDemoAssets(): Asset[] {
  const now = new Date();
  return DEMO_SEEDS.map((d, i) => ({
    id: `demo-${i + 1}`,
    workdriveId: `demo-${i + 1}`,
    workdrivePath: d.path,
    filename: d.filename,
    blobUrl: d.thumb || null,
    type: d.type,
    mimeType: d.type === "photo" ? "image/svg+xml" : "video/mp4",
    bytes: null,
    tags: d.tags,
    suitablePostTypes: d.suitable,
    taggedAt: now,
    taggingModel: "demo",
    createdAt: now,
    updatedAt: now,
  }));
}
