// ---------------------------------------------------------------------------
// Apify Social Media Scraping — Instagram & TikTok
//
// Uses the Apify REST API directly (no npm client) to avoid Vercel bundling
// issues. Scrapes competitor social media via Apify actors.
//
// Actors:
//   - Instagram: apify/instagram-post-scraper
//   - TikTok:    clockworks/tiktok-scraper
//
// Env: APIFY_API_KEY
// ---------------------------------------------------------------------------

import type { CompetitorSocialHandle } from "@/agents/competitor-social-agent.config";

const APIFY_BASE = "https://api.apify.com/v2";

// Apify actor IDs
const INSTAGRAM_ACTOR = "apify~instagram-post-scraper";
const TIKTOK_ACTOR = "clockworks~tiktok-scraper";

function getToken(): string {
  const token = process.env.APIFY_API_KEY;
  if (!token) {
    throw new Error("APIFY_API_KEY environment variable is not set");
  }
  return token;
}

// ---------------------------------------------------------------------------
// Generic Apify actor runner — start, wait, fetch results
// ---------------------------------------------------------------------------

async function runActor(
  actorId: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  const token = getToken();

  // Start the actor run and wait for it to finish (synchronous run)
  const runRes = await fetch(
    `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  if (!runRes.ok) {
    const errText = await runRes.text();
    throw new Error(
      `Apify actor ${actorId} failed (${runRes.status}): ${errText.slice(0, 500)}`
    );
  }

  return (await runRes.json()) as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Instagram scraping
// ---------------------------------------------------------------------------

interface InstagramPost {
  username: string;
  caption: string;
  likesCount: number;
  commentsCount: number;
  type: string; // "Image", "Video", "Sidecar" (carousel)
  timestamp: string;
  url: string;
}

async function scrapeInstagram(
  handles: string[],
  daysBack: number = 7
): Promise<InstagramPost[]> {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - daysBack);

  const allItems = await runActor(INSTAGRAM_ACTOR, {
    username: handles,
    resultsLimit: 50,
  });

  // Filter to posts within the date window
  const sinceTs = sinceDate.getTime();
  return allItems
    .filter((item) => {
      const ts = item.timestamp ?? item.takenAt;
      if (!ts) return true;
      return new Date(String(ts)).getTime() >= sinceTs;
    })
    .map((item) => ({
      username: String(item.ownerUsername ?? item.username ?? ""),
      caption: String(item.caption ?? ""),
      likesCount: Number(item.likesCount ?? 0),
      commentsCount: Number(item.commentsCount ?? 0),
      type: String(item.type ?? "Unknown"),
      timestamp: String(item.timestamp ?? item.takenAt ?? ""),
      url: String(
        item.url ??
          (item.shortCode
            ? `https://www.instagram.com/p/${item.shortCode}/`
            : "")
      ),
    }));
}

// ---------------------------------------------------------------------------
// TikTok scraping
// ---------------------------------------------------------------------------

interface TikTokPost {
  username: string;
  text: string;
  diggCount: number; // likes
  commentCount: number;
  shareCount: number;
  playCount: number;
  createTime: string;
  webVideoUrl: string;
}

async function scrapeTikTok(
  handles: string[],
  daysBack: number = 7
): Promise<TikTokPost[]> {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - daysBack);
  const sinceTimestamp = Math.floor(sinceDate.getTime() / 1000);

  const items = await runActor(TIKTOK_ACTOR, {
    profiles: handles.map((h) => h.replace(/^@/, "")),
    resultsPerPage: 30,
    shouldDownloadVideos: false,
  });

  // Filter to last N days
  return items
    .filter((item) => {
      const ts = Number(item.createTime ?? 0);
      return ts >= sinceTimestamp;
    })
    .map((item) => ({
      username: String(
        item.authorMeta &&
          typeof item.authorMeta === "object" &&
          "name" in item.authorMeta
          ? (item.authorMeta as Record<string, unknown>).name
          : item.author ?? ""
      ),
      text: String(item.text ?? ""),
      diggCount: Number(item.diggCount ?? 0),
      commentCount: Number(item.commentCount ?? 0),
      shareCount: Number(item.shareCount ?? 0),
      playCount: Number(item.playCount ?? 0),
      createTime: new Date(
        Number(item.createTime ?? 0) * 1000
      ).toISOString(),
      webVideoUrl: String(item.webVideoUrl ?? ""),
    }));
}

// ---------------------------------------------------------------------------
// Combined scrape — returns formatted text for Claude
// ---------------------------------------------------------------------------

export interface SocialScrapeResult {
  scanDate: string;
  formattedData: string;
  instagramPostCount: number;
  tiktokPostCount: number;
}

export async function scrapeCompetitorSocials(
  competitors: CompetitorSocialHandle[],
  daysBack: number = 7
): Promise<SocialScrapeResult> {
  const scanDate = new Date().toISOString();

  const igHandles = competitors.map((c) => c.instagram);
  const ttHandles = competitors.map((c) => c.tiktok);

  // Run both scrapers in parallel
  const [igPosts, ttPosts] = await Promise.all([
    scrapeInstagram(igHandles, daysBack),
    scrapeTikTok(ttHandles, daysBack),
  ]);

  // Format Instagram data
  let formatted = "## INSTAGRAM DATA (Last 7 Days)\n\n";
  for (const competitor of competitors) {
    const posts = igPosts.filter(
      (p) => p.username.toLowerCase() === competitor.instagram.toLowerCase()
    );
    formatted += `### ${competitor.brand} (@${competitor.instagram})\n`;
    formatted += `Posts this week: ${posts.length}\n\n`;

    if (posts.length === 0) {
      formatted += "No posts found in this period.\n\n";
      continue;
    }

    formatted += "| Date | Type | Likes | Comments | Caption (first 120 chars) |\n";
    formatted += "|------|------|-------|----------|---------------------------|\n";
    for (const post of posts) {
      const date = post.timestamp
        ? new Date(post.timestamp).toISOString().slice(0, 10)
        : "N/A";
      const caption = post.caption.replace(/\n/g, " ").slice(0, 120);
      formatted += `| ${date} | ${post.type} | ${post.likesCount.toLocaleString()} | ${post.commentsCount.toLocaleString()} | ${caption} |\n`;
    }
    formatted += "\n";
  }

  // Format TikTok data
  formatted += "\n## TIKTOK DATA (Last 7 Days)\n\n";
  for (const competitor of competitors) {
    const handle = competitor.tiktok.replace(/^@/, "").toLowerCase();
    const posts = ttPosts.filter(
      (p) => p.username.toLowerCase() === handle
    );
    formatted += `### ${competitor.brand} (${competitor.tiktok})\n`;
    formatted += `Posts this week: ${posts.length}\n\n`;

    if (posts.length === 0) {
      formatted += "No posts found in this period.\n\n";
      continue;
    }

    formatted += "| Date | Plays | Likes | Comments | Shares | Caption (first 120 chars) |\n";
    formatted += "|------|-------|-------|----------|--------|---------------------------|\n";
    for (const post of posts) {
      const date = post.createTime
        ? new Date(post.createTime).toISOString().slice(0, 10)
        : "N/A";
      const caption = post.text.replace(/\n/g, " ").slice(0, 120);
      formatted += `| ${date} | ${post.playCount.toLocaleString()} | ${post.diggCount.toLocaleString()} | ${post.commentCount.toLocaleString()} | ${post.shareCount.toLocaleString()} | ${caption} |\n`;
    }
    formatted += "\n";
  }

  return {
    scanDate,
    formattedData: formatted,
    instagramPostCount: igPosts.length,
    tiktokPostCount: ttPosts.length,
  };
}
