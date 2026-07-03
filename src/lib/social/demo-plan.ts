import type { Post, Gap } from "@/lib/social/db/schema";

/**
 * Demo plan data for preview mode (no DATABASE_URL / no ANTHROPIC_API_KEY).
 * The skeleton is generated live by buildSkeleton() in queries.ts — only the
 * AI-written posts + gaps are hand-authored here so the /posts and /gaps screens
 * show realistic, on-brand Phase 2 output in the Vercel preview.
 */

function mkPost(p: Partial<Post> & { platform: string; pillar: string }): Post {
  const now = new Date();
  return {
    id: cryptoId(),
    scheduledDate: p.scheduledDate ?? null,
    platform: p.platform,
    pillar: p.pillar,
    format: p.format ?? null,
    copy: p.copy ?? null,
    hashtags: p.hashtags ?? [],
    cta: p.cta ?? null,
    status: p.status ?? "needs_review",
    assetId: p.assetId ?? null,
    renderUrl: p.renderUrl ?? null,
    editBrief: p.editBrief ?? null,
    renderKind: p.renderKind ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

let _c = 0;
function cryptoId() {
  _c += 1;
  return `demo-post-${_c}`;
}

const d = (offset: number) => {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() + offset);
  return x.toISOString().slice(0, 10);
};

export const DEMO_POSTS: Post[] = [
  // Piece 1 — Don't-Be-A-Sheep (static), IG + FB
  mkPost({
    scheduledDate: d(1),
    platform: "instagram",
    pillar: "Don't-Be-A-Sheep",
    format: "static",
    copy: "Same carbon. Same pros. Half the logo tax.\n\nThe big brands spend millions making you believe the name on the stick is what scores goals. It isn't. Pro-level layup, custom curve, your flex — without paying for someone else's billboard. Don't be a sheep.",
    hashtags: ["#DontBeASheep", "#StopOverpaying", "#TiltHockey", "#BuiltForPlayers"],
    cta: "Build yours at tilthockey.com",
    renderKind: "nano",
    renderUrl: "/demo/renders/demo-render-sheep.png",
    editBrief: "Static: X1 player stick studio shot on black, cyan accent slash, display text 'HALF THE LOGO TAX'. Code overlays TILT logo bottom-right.",
  }),
  mkPost({
    scheduledDate: d(1),
    platform: "facebook",
    pillar: "Don't-Be-A-Sheep",
    format: "static",
    copy: "We did the math so you don't have to. Same pro-level carbon the big names use, built to your curve and flex — without the brand-name markup. That's not a knock on tradition. It's a wake-up call for players who'd rather spend the difference on ice time. Don't be a sheep.",
    hashtags: ["#DontBeASheep", "#TiltHockey", "#HockeyFamily"],
    cta: "Customize your stick — link in comments",
    renderKind: "nano",
    editBrief: "Same treatment as IG, 4:5 crop for feed.",
  }),
  // Piece 2 — Proof / Performance (reel), IG + TikTok + FB
  mkPost({
    scheduledDate: d(3),
    platform: "instagram",
    pillar: "Proof / Performance",
    format: "reel",
    copy: "Flex loaded. Blade through the puck. That's the whole pitch.\n\nNo lab claims, no hype reel — just a real shot from a real player on a real X1. Watch the load and release. That's performance without the hype.",
    hashtags: ["#ProvenOnIce", "#ShotSpeed", "#GoFullTilt", "#TiltHockey"],
    cta: "Drop a 🏒 if you're switching",
    renderKind: "shotstack",
    editBrief: "Reel from SCHREMP slapshot clip: trim to load+release, 9:16, cyan lower-third, TILT logo wrap, licensed track.",
  }),
  mkPost({
    scheduledDate: d(3),
    platform: "tiktok",
    pillar: "Proof / Performance",
    format: "reel",
    copy: "POV: you stopped paying for the logo and your shot didn't notice 👀 real flex, real release, real X1. no hype.",
    hashtags: ["#hockeytiktok", "#hockey", "#DontBeASheep", "#shotspeed"],
    cta: "link in bio to build yours",
    renderKind: "shotstack",
    editBrief: "Same source clip, native TikTok caption styling, faster cut, trending-audio friendly.",
  }),
  mkPost({
    scheduledDate: d(3),
    platform: "facebook",
    pillar: "Proof / Performance",
    format: "reel",
    copy: "Performance without the hype. One real shot, one real stick — watch the flex load and the blade snap through. The X1 does the talking. Tag a teammate who needs to see this.",
    hashtags: ["#ProvenOnIce", "#TiltHockey"],
    cta: "Tag a teammate who needs to see this",
    renderKind: "shotstack",
    editBrief: "Reel, 1:1 or 9:16, captions burned in for sound-off autoplay.",
  }),
  // Piece 3 — Athletes / Ambassadors (reel) — GAP example
  mkPost({
    scheduledDate: d(6),
    platform: "instagram",
    pillar: "Athletes / Ambassadors",
    format: "reel",
    copy: "Pros don't chase logos. They chase performance.\n\nReal players, real bench, real Tilt in hand. When the guys who've played at the highest level pick the stick on value and feel — not the name — that tells you everything.",
    hashtags: ["#TeamTilt", "#TiltAmbassador", "#DontBeASheep"],
    cta: "Customize your stick — link in bio",
    renderKind: "manual",
    editBrief: "Hero edit from ambassador bench footage — flag for manual editing (creative cut, color, captions).",
  }),
  // Piece 4 — Fit / Education (carousel), IG + FB
  mkPost({
    scheduledDate: d(8),
    platform: "instagram",
    pillar: "Fit / Education",
    format: "carousel",
    copy: "Flex, curve, length — the Tilt Genius 101.\n\nSlide 1: pick flex by body weight + style. Slide 2: curve = where you shoot from. Slide 3: length = stance + hand. Get these right and the stick disappears — in the best way.",
    hashtags: ["#TiltGenius", "#FlexAndCurve", "#StickFit", "#TiltHockey"],
    cta: "Build yours at tilthockey.com",
    renderKind: "nano",
    renderUrl: "/demo/renders/demo-render-fit.png",
    editBrief: "3-slide carousel from flex/curve close-up photo + callouts. Code overlays TILT logo on each slide.",
  }),
];

export const DEMO_GAPS: Gap[] = [
  {
    id: "demo-gap-1",
    weekStart: d(0),
    neededAssetDescription:
      "Vertical (9:16) clip of a player loading flex + releasing a slapshot, clean rink background — for Proof reels. Current library is landscape only.",
    status: "open",
    createdAt: new Date(),
  },
  {
    id: "demo-gap-2",
    weekStart: d(7),
    neededAssetDescription:
      "Close-up macro photo of the X1 blade curve with room for text callouts — needed for the Fit/Education 'Tilt Genius' carousel.",
    status: "open",
    createdAt: new Date(),
  },
  {
    id: "demo-gap-3",
    weekStart: d(7),
    neededAssetDescription:
      "Komoka Kings team in Tilt gear at a tournament (TEP, June) — grassroots/community pillar has no recent team action shots.",
    status: "open",
    createdAt: new Date(),
  },
];
