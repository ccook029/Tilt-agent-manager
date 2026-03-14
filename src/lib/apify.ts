// ---------------------------------------------------------------------------
// Apify Social Media Scraping — Instagram & TikTok
//
// Uses the Apify API to scrape competitor social media accounts.
// Actors:
//   - Instagram: apify/instagram-post-scraper
//   - TikTok:    clockworks/tiktok-scraper
//
// Env: APIFY_API_KEY
// ---------------------------------------------------------------------------

import { ApifyClient } from "apify-client";
import type { CompetitorSocialHandle } from "@/agents/competitor-social-agent.config";

// Apify actor IDs
const INSTAGRAM_ACTOR = "apify/instagram-post-scraper";
const TIKTOK_ACTOR = "clockworks/tiktok-scraper";

function getClient(): ApifyClient {
  const token = process.env.APIFY_API_KEY;
  if (!token) {
    throw new Error("APIFY_API_KEY environment variable is not set");
  }
  return new ApifyClient({ token });
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
  const client = getClient();
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - daysBack);

  const run = await client.actor(INSTAGRAM_ACTOR).call({
    directUrls: handles.map((h) => `https://www.instagram.com/${h}/`),
    resultsLimit: 50, // per profile
    onlyPostsNewerThan: sinceDate.toISOString().slice(0, 10),
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  return (items as Record<string, unknown>[]).map((item) => ({
    username: String(item.ownerUsername ?? item.username ?? ""),
    caption: String(item.caption ?? ""),
    likesCount: Number(item.likesCount ?? 0),
    commentsCount: Number(item.commentsCount ?? 0),
    type: String(item.type ?? "Unknown"),
    timestamp: String(item.timestamp ?? item.takenAt ?? ""),
    url: String(item.url ?? item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : ""),
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
  const client = getClient();
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - daysBack);
  const sinceTimestamp = Math.floor(sinceDate.getTime() / 1000);

  const run = await client.actor(TIKTOK_ACTOR).call({
    profiles: handles.map((h) => h.replace(/^@/, "")),
    resultsPerPage: 30,
    shouldDownloadVideos: false,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  // Filter to last N days
  return (items as Record<string, unknown>[])
    .filter((item) => {
      const ts = Number(item.createTime ?? 0);
      return ts >= sinceTimestamp;
    })
    .map((item) => ({
      username: String(item.authorMeta && typeof item.authorMeta === "object" && "name" in item.authorMeta ? item.authorMeta.name : item.author ?? ""),
      text: String(item.text ?? ""),
      diggCount: Number(item.diggCount ?? 0),
      commentCount: Number(item.commentCount ?? 0),
      shareCount: Number(item.shareCount ?? 0),
      playCount: Number(item.playCount ?? 0),
      createTime: new Date(Number(item.createTime ?? 0) * 1000).toISOString(),
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

  // Build a brand lookup from handle to brand name
  const igBrandMap = new Map(competitors.map((c) => [c.instagram.toLowerCase(), c.brand]));
  const ttBrandMap = new Map(competitors.map((c) => [c.tiktok.replace(/^@/, "").toLowerCase(), c.brand]));

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
      const date = post.timestamp ? new Date(post.timestamp).toISOString().slice(0, 10) : "N/A";
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
      const date = post.createTime ? new Date(post.createTime).toISOString().slice(0, 10) : "N/A";
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
