// ---------------------------------------------------------------------------
// competitors.ts — Competitor intelligence data pipeline
//
// Uses two data sources:
//   1. Serper.dev — Google Search, Google Shopping, Google News via API
//   2. Google News RSS — additional free news coverage (no API key needed)
//
// No web scraping — reliable API-based data collection.
// ---------------------------------------------------------------------------

export interface CompetitorProfile {
  name: string;
  url: string;
  categories: string[];
}

export const COMPETITORS: CompetitorProfile[] = [
  { name: "Bauer", url: "https://www.bauer.com", categories: ["sticks", "skates", "helmets", "gloves", "pants", "protective"] },
  { name: "CCM", url: "https://www.ccmhockey.com", categories: ["sticks", "skates", "helmets", "gloves", "pants", "protective"] },
  { name: "True", url: "https://www.truehockey.com", categories: ["sticks", "skates", "gloves", "protective"] },
  { name: "Warrior", url: "https://www.warrior.com", categories: ["sticks", "gloves", "helmets", "pants", "protective"] },
  { name: "Sherwood", url: "https://www.sherwoodhockey.com", categories: ["sticks", "gloves"] },
  { name: "Eagle Hockey", url: "https://www.eaglehockey.com", categories: ["gloves", "pants"] },
  { name: "Vaughn Hockey", url: "https://www.vaughnhockey.com", categories: ["goalie"] },
];

// ---- Types ---------------------------------------------------------------

export interface SearchResult {
  competitor: string;
  category: string;     // "products", "sponsorship", "patent", "news", "pricing"
  title: string;
  snippet: string;
  url: string;
  source: string;       // "serper", "serper-shopping", "serper-news", "google-news-rss"
  price?: string;       // from Google Shopping results
  publishedDate?: string;
}

export interface CompetitorScanResult {
  competitor: string;
  results: SearchResult[];
}

// ---- Serper.dev API ------------------------------------------------------

interface SerperWebResult {
  title: string;
  snippet: string;
  link: string;
  date?: string;
}

interface SerperShoppingResult {
  title: string;
  price: string;
  link: string;
  source: string;
  delivery?: string;
}

interface SerperNewsResult {
  title: string;
  snippet: string;
  link: string;
  date: string;
  source: string;
}

/**
 * Google Search via Serper.dev — web results.
 * Requires SERPER_API_KEY env var.
 */
async function serperWebSearch(
  query: string,
  num: number = 5
): Promise<SerperWebResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("[competitors] SERPER_API_KEY not set — skipping Serper web search");
    return [];
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num, tbs: "qdr:w" }), // past week
    });

    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[competitors] Serper web search failed: HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return data.organic ?? [];
  } catch (err) {
    console.error("[competitors] Serper web search error:", err);
    return [];
  }
}

/**
 * Google Shopping via Serper.dev — pricing data.
 */
async function serperShoppingSearch(
  query: string,
  num: number = 10
): Promise<SerperShoppingResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch("https://google.serper.dev/shopping", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num }),
    });

    clearTimeout(timeout);
    if (!res.ok) return [];

    const data = await res.json();
    return data.shopping ?? [];
  } catch (err) {
    console.error("[competitors] Serper shopping search error:", err);
    return [];
  }
}

/**
 * Google News via Serper.dev — recent news articles.
 */
async function serperNewsSearch(
  query: string,
  num: number = 5
): Promise<SerperNewsResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch("https://google.serper.dev/news", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num, tbs: "qdr:w" }),
    });

    clearTimeout(timeout);
    if (!res.ok) return [];

    const data = await res.json();
    return data.news ?? [];
  } catch (err) {
    console.error("[competitors] Serper news search error:", err);
    return [];
  }
}

// ---- Google News RSS (free, no API key) ----------------------------------

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
}

async function googleNewsRSS(query: string): Promise<RSSItem[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const encodedQuery = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TiltIntelBot/1.0)" },
    });

    clearTimeout(timeout);
    if (!res.ok) return [];

    const xml = await res.text();
    return parseRSSItems(xml);
  } catch (err) {
    console.error("[competitors] Google News RSS error:", err);
    return [];
  }
}

function parseRSSItems(xml: string): RSSItem[] {
  const items: RSSItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTag(itemXml, "title");
    const link = extractTag(itemXml, "link");
    const description = extractTag(itemXml, "description");
    const pubDate = extractTag(itemXml, "pubDate");
    const source = extractTag(itemXml, "source");

    if (title && link) {
      items.push({
        title: decodeEntities(title),
        link,
        description: decodeEntities(description),
        pubDate,
        source: decodeEntities(source),
      });
    }
  }

  return items.slice(0, 10);
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(regex);
  return m ? (m[1] ?? m[2] ?? "").trim() : "";
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "");
}

// ---- Main scan pipeline --------------------------------------------------

/** Max age for results in milliseconds (14 days). */
const MAX_RESULT_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Check whether a result's published date is within the acceptable window.
 * If no date is available, we keep it (let the prompt handle uncertainty).
 */
function isRecentEnough(publishedDate: string | undefined): boolean {
  if (!publishedDate) return true; // no date → keep, prompt will flag as undated
  const parsed = new Date(publishedDate);
  if (isNaN(parsed.getTime())) return true; // unparseable → keep
  return Date.now() - parsed.getTime() <= MAX_RESULT_AGE_MS;
}

/**
 * Build all search queries for a competitor, organized by intel category.
 */
function buildQueries(comp: CompetitorProfile): { query: string; category: string; type: "web" | "shopping" | "news" }[] {
  const year = new Date().getFullYear();
  const name = comp.name;

  return [
    // Web searches — products, sponsorships, patents
    { query: `"${name}" hockey new product launch ${year}`, category: "products", type: "web" },
    { query: `"${name}" hockey new stick OR skate OR helmet ${year}`, category: "products", type: "web" },
    { query: `"${name}" hockey sponsorship OR sponsor OR partnership`, category: "sponsorship", type: "web" },
    { query: `"${name}" hockey OJHL OR PJHL OR OHL OR NHL deal`, category: "sponsorship", type: "web" },
    { query: `"${name}" hockey patent OR "patent application"`, category: "patent", type: "web" },

    // Shopping searches — pricing data
    { query: `${name} hockey stick`, category: "pricing", type: "shopping" },
    { query: `${name} hockey skates`, category: "pricing", type: "shopping" },
    { query: `${name} hockey gloves`, category: "pricing", type: "shopping" },
    { query: `${name} hockey helmet`, category: "pricing", type: "shopping" },

    // News searches via Serper
    { query: `"${name}" hockey`, category: "news", type: "news" },
  ];
}

/**
 * Gather intel for a single competitor.
 *
 * Always uses Google News RSS (free, no key).
 * If SERPER_API_KEY is set, also runs Serper.dev for deeper intel
 * (Google Web Search, Shopping prices, News).
 */
async function gatherCompetitorIntel(
  competitor: CompetitorProfile
): Promise<CompetitorScanResult> {
  const allResults: SearchResult[] = [];
  const hasSerper = !!process.env.SERPER_API_KEY;

  // --- Google News RSS (always runs — free) ---
  const rssQueries = [
    `${competitor.name} hockey`,
    `${competitor.name} hockey new product OR launch`,
    `${competitor.name} hockey sponsorship OR sponsor`,
    `${competitor.name} hockey patent`,
    `${competitor.name} hockey price OR pricing`,
  ];

  const rssResults = await Promise.all(
    rssQueries.map((q) => googleNewsRSS(q))
  );

  for (const items of rssResults) {
    for (const item of items) {
      if (!isRecentEnough(item.pubDate)) continue;
      allResults.push({
        competitor: competitor.name,
        category: categorizeNewsItem(item.title + " " + item.description),
        title: item.title,
        snippet: item.description,
        url: item.link,
        source: "google-news-rss",
        publishedDate: item.pubDate,
      });
    }
  }

  // --- Serper.dev (optional — only if API key is set) ---
  if (hasSerper) {
    const queries = buildQueries(competitor);
    const webQueries = queries.filter((q) => q.type === "web");
    const shoppingQueries = queries.filter((q) => q.type === "shopping");
    const newsQueries = queries.filter((q) => q.type === "news");

    const [webResults, shoppingResults, serperNews] = await Promise.all([
      Promise.all(
        webQueries.map(async ({ query, category }) => {
          const results = await serperWebSearch(query, 5);
          return results.map((r) => ({
            competitor: competitor.name,
            category,
            title: r.title,
            snippet: r.snippet,
            url: r.link,
            source: "serper",
            publishedDate: r.date,
          }));
        })
      ),
      Promise.all(
        shoppingQueries.map(async ({ query, category }) => {
          const results = await serperShoppingSearch(query, 10);
          return results.map((r) => ({
            competitor: competitor.name,
            category,
            title: r.title,
            snippet: `${r.price} — ${r.source}`,
            url: r.link,
            source: "serper-shopping",
            price: r.price,
          }));
        })
      ),
      Promise.all(
        newsQueries.map(async ({ query, category }) => {
          const results = await serperNewsSearch(query, 5);
          return results.map((r) => ({
            competitor: competitor.name,
            category,
            title: r.title,
            snippet: r.snippet,
            url: r.link,
            source: "serper-news",
            publishedDate: r.date,
          }));
        })
      ),
    ]);

    for (const batch of webResults) allResults.push(...batch);
    for (const batch of shoppingResults) allResults.push(...batch);
    for (const batch of serperNews) allResults.push(...batch);
  }

  // Deduplicate by URL and filter out stale results (>14 days old)
  const seen = new Set<string>();
  const deduped = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    if (!isRecentEnough(r.publishedDate)) return false;
    seen.add(r.url);
    return true;
  });

  return {
    competitor: competitor.name,
    results: deduped,
  };
}

/**
 * Auto-categorize a news item based on keywords in its title/description.
 */
function categorizeNewsItem(text: string): string {
  const lower = text.toLowerCase();
  if (/patent|intellectual property|filing|USPTO/i.test(lower)) return "patent";
  if (/sponsor|partnership|deal|sign|endorse|league/i.test(lower)) return "sponsorship";
  if (/price|pricing|\$|msrp|sale|discount/i.test(lower)) return "pricing";
  if (/launch|new|release|announce|unveil|introduce/i.test(lower)) return "products";
  return "news";
}

/**
 * Run a full competitor scan across all tracked competitors.
 */
export async function runCompetitorScan(): Promise<{
  scans: CompetitorScanResult[];
  scanDate: string;
  summary: string;
}> {
  const scanDate = new Date().toISOString();

  const scans = await Promise.all(
    COMPETITORS.map((comp) => gatherCompetitorIntel(comp))
  );

  const summary = formatScanForPrompt(scans);
  return { scans, scanDate, summary };
}

/**
 * Format scan results into a text block for the AI prompt.
 */
function formatScanForPrompt(scans: CompetitorScanResult[]): string {
  const sections: string[] = [];

  for (const scan of scans) {
    const lines: string[] = [`## ${scan.competitor}`];
    const totalResults = scan.results.length;

    if (totalResults === 0) {
      lines.push("\nNo recent intel found for this competitor.");
      sections.push(lines.join("\n"));
      continue;
    }

    lines.push(`\nFound ${totalResults} results across search and news sources.\n`);

    // Group by category
    const categories = new Map<string, SearchResult[]>();
    for (const r of scan.results) {
      const existing = categories.get(r.category) ?? [];
      existing.push(r);
      categories.set(r.category, existing);
    }

    const categoryLabels: Record<string, string> = {
      products: "Product Launches & New SKUs",
      pricing: "Pricing Intel (Google Shopping)",
      sponsorship: "Sponsorships & Partnerships",
      patent: "Patent Activity",
      news: "Recent News & Press",
    };

    for (const [category, results] of categories) {
      lines.push(`### ${categoryLabels[category] ?? category}`);

      if (category === "pricing") {
        // Format pricing as a table for easy comparison
        lines.push("");
        lines.push("| Product | Price | Source |");
        lines.push("|---------|-------|--------|");
        for (const r of results.slice(0, 15)) {
          lines.push(`| ${r.title} | ${r.price ?? "N/A"} | ${r.url} |`);
        }
        lines.push("");
      } else {
        for (const r of results.slice(0, 8)) {
          lines.push(`- **${r.title}**`);
          if (r.snippet) lines.push(`  ${r.snippet.slice(0, 300)}`);
          lines.push(`  Source: ${r.source} | ${r.url}`);
          if (r.publishedDate) lines.push(`  Published: ${r.publishedDate}`);
        }
        lines.push("");
      }
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n---\n\n");
}
