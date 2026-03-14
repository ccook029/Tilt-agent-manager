// ---------------------------------------------------------------------------
// competitors.ts — Competitor intelligence data pipeline
//
// Uses two sources to gather intel on hockey equipment competitors:
//   1. Brave Search API — web search for products, pricing, sponsorships, patents
//   2. Google News RSS  — recent news coverage and press releases
//
// No web scraping needed — these APIs are reliable and don't get blocked.
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
  source: string;       // "brave" or "google-news"
  publishedDate?: string;
}

export interface CompetitorScanResult {
  competitor: string;
  results: SearchResult[];
}

// ---- Brave Search API ----------------------------------------------------

interface BraveWebResult {
  title: string;
  description: string;
  url: string;
  page_age?: string;
}

interface BraveSearchResponse {
  web?: { results: BraveWebResult[] };
  news?: { results: { title: string; description: string; url: string; age: string }[] };
}

/**
 * Search Brave for a specific query. Returns up to `count` results.
 * Requires BRAVE_SEARCH_API_KEY env var.
 */
async function braveSearch(
  query: string,
  count: number = 5
): Promise<BraveWebResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    console.warn("[competitors] BRAVE_SEARCH_API_KEY not set — skipping Brave search");
    return [];
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const params = new URLSearchParams({
      q: query,
      count: count.toString(),
      freshness: "pw", // past week
      text_decorations: "false",
    });

    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
      }
    );

    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`[competitors] Brave search failed: HTTP ${res.status}`);
      return [];
    }

    const data: BraveSearchResponse = await res.json();
    return data.web?.results ?? [];
  } catch (err) {
    console.error("[competitors] Brave search error:", err);
    return [];
  }
}

/**
 * Search Brave News for a specific query.
 */
async function braveNewsSearch(
  query: string,
  count: number = 5
): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const params = new URLSearchParams({
      q: query,
      count: count.toString(),
      freshness: "pw",
    });

    const res = await fetch(
      `https://api.search.brave.com/res/v1/news/search?${params}`,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
      }
    );

    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = await res.json();
    const results: SearchResult[] = (data.results ?? []).map(
      (r: { title: string; description: string; url: string; age?: string }) => ({
        competitor: "",
        category: "news",
        title: r.title,
        snippet: r.description,
        url: r.url,
        source: "brave-news",
        publishedDate: r.age,
      })
    );

    return results;
  } catch {
    return [];
  }
}

// ---- Google News RSS -----------------------------------------------------

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
}

/**
 * Fetch Google News RSS for a query. No API key needed.
 * Returns parsed news items.
 */
async function googleNewsRSS(query: string): Promise<RSSItem[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const encodedQuery = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TiltIntelBot/1.0)",
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`[competitors] Google News RSS failed: HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    return parseRSSItems(xml);
  } catch (err) {
    console.error("[competitors] Google News RSS error:", err);
    return [];
  }
}

/**
 * Basic XML parser for RSS <item> elements.
 * No external dependency needed — just regex extraction.
 */
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

  return items.slice(0, 10); // cap at 10 per query
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? (match[1] ?? match[2] ?? "").trim() : "";
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ""); // strip any HTML tags in descriptions
}

// ---- Main scan pipeline --------------------------------------------------

/** Search queries per competitor, organized by intel category. */
function buildSearchQueries(competitor: CompetitorProfile): { query: string; category: string }[] {
  const year = new Date().getFullYear();
  const name = competitor.name;

  return [
    // Product launches
    { query: `"${name}" hockey new product launch ${year}`, category: "products" },
    { query: `"${name}" hockey new stick OR skate OR helmet ${year}`, category: "products" },
    // Pricing
    { query: `"${name}" hockey price OR pricing OR MSRP ${year}`, category: "pricing" },
    // Sponsorships
    { query: `"${name}" hockey sponsorship OR sponsor OR partnership`, category: "sponsorship" },
    { query: `"${name}" hockey OJHL OR PJHL OR OHL OR NHL deal`, category: "sponsorship" },
    // Patents
    { query: `"${name}" hockey patent OR patent application`, category: "patent" },
  ];
}

/**
 * Gather intel for a single competitor using Brave Search + Google News RSS.
 */
async function gatherCompetitorIntel(
  competitor: CompetitorProfile
): Promise<CompetitorScanResult> {
  const queries = buildSearchQueries(competitor);
  const allResults: SearchResult[] = [];

  // Run Brave web searches and Google News RSS in parallel
  const bravePromises = queries.map(async ({ query, category }) => {
    const webResults = await braveSearch(query, 5);
    return webResults.map((r) => ({
      competitor: competitor.name,
      category,
      title: r.title,
      snippet: r.description,
      url: r.url,
      source: "brave" as const,
      publishedDate: r.page_age,
    }));
  });

  const newsPromises = [
    // Google News RSS — broad competitor search + specific topics
    googleNewsRSS(`${competitor.name} hockey`),
    googleNewsRSS(`${competitor.name} hockey sponsorship`),
    googleNewsRSS(`${competitor.name} hockey patent`),
  ];

  const braveNewsPromises = [
    braveNewsSearch(`${competitor.name} hockey equipment ${new Date().getFullYear()}`),
  ];

  const [braveResults, newsResults, braveNews] = await Promise.all([
    Promise.all(bravePromises),
    Promise.all(newsPromises),
    Promise.all(braveNewsPromises),
  ]);

  // Flatten Brave web results
  for (const batch of braveResults) {
    allResults.push(...batch);
  }

  // Convert Google News RSS items to SearchResults
  for (const items of newsResults) {
    for (const item of items) {
      allResults.push({
        competitor: competitor.name,
        category: "news",
        title: item.title,
        snippet: item.description,
        url: item.link,
        source: "google-news",
        publishedDate: item.pubDate,
      });
    }
  }

  // Add Brave News results
  for (const batch of braveNews) {
    for (const result of batch) {
      allResults.push({ ...result, competitor: competitor.name });
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return {
    competitor: competitor.name,
    results: deduped,
  };
}

/**
 * Run a full competitor scan across all tracked competitors.
 * Returns structured data ready to be formatted into a prompt.
 */
export async function runCompetitorScan(): Promise<{
  scans: CompetitorScanResult[];
  scanDate: string;
  summary: string;
}> {
  const scanDate = new Date().toISOString();

  // Gather intel for all competitors concurrently
  const scans = await Promise.all(
    COMPETITORS.map((comp) => gatherCompetitorIntel(comp))
  );

  // Build a text summary for the AI prompt
  const summary = formatScanForPrompt(scans);

  return { scans, scanDate, summary };
}

/**
 * Format scan results into a text block suitable for the AI prompt.
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
      pricing: "Pricing Intel",
      sponsorship: "Sponsorships & Partnerships",
      patent: "Patent Activity",
      news: "Recent News & Press",
    };

    for (const [category, results] of categories) {
      lines.push(`### ${categoryLabels[category] ?? category}`);
      for (const r of results.slice(0, 8)) {
        lines.push(`- **${r.title}**`);
        if (r.snippet) lines.push(`  ${r.snippet.slice(0, 300)}`);
        lines.push(`  Source: ${r.source} | ${r.url}`);
        if (r.publishedDate) lines.push(`  Published: ${r.publishedDate}`);
      }
      lines.push("");
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n---\n\n");
}
