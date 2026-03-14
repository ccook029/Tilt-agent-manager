// ---------------------------------------------------------------------------
// competitors.ts — Web scraping pipeline for competitor intelligence
//
// Scrapes competitor websites for product/pricing data, and searches
// for news on launches, sponsorships, and patents.
// ---------------------------------------------------------------------------

export interface CompetitorProfile {
  name: string;
  url: string;
  categories: string[]; // e.g. "sticks", "gloves", "helmets", "skates"
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

export interface ScrapedPage {
  competitor: string;
  url: string;
  title: string;
  content: string;
  scrapedAt: string;
  status: "ok" | "error";
  error?: string;
}

export interface CompetitorScanResult {
  competitor: string;
  pages: ScrapedPage[];
  newsResults: NewsResult[];
}

export interface NewsResult {
  competitor: string;
  headline: string;
  source: string;
  snippet: string;
  url: string;
}

/**
 * Scrape a single URL and return its text content.
 * Uses a simple fetch with timeout — no headless browser needed.
 */
async function scrapePage(
  competitor: string,
  url: string
): Promise<ScrapedPage> {
  const scrapedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TiltIntelBot/1.0; +https://tiltsports.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return {
        competitor,
        url,
        title: "",
        content: "",
        scrapedAt,
        status: "error",
        error: `HTTP ${res.status}`,
      };
    }

    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // Strip HTML to get text content (basic approach)
    const content = htmlToText(html);

    // Limit content size to avoid huge prompts
    const trimmedContent = content.slice(0, 8000);

    return {
      competitor,
      url,
      title,
      content: trimmedContent,
      scrapedAt,
      status: "ok",
    };
  } catch (err) {
    return {
      competitor,
      url,
      title: "",
      content: "",
      scrapedAt,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Basic HTML to text conversion — strips tags, decodes common entities,
 * collapses whitespace.
 */
function htmlToText(html: string): string {
  return html
    // Remove script/style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    // Replace common block elements with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

/**
 * Scrape key pages for a single competitor.
 * Focuses on new products, collections, and news pages.
 */
async function scrapeCompetitor(
  competitor: CompetitorProfile
): Promise<ScrapedPage[]> {
  // Common paths where hockey companies list products and news
  const paths = [
    "/",
    "/new",
    "/collections",
    "/products",
    "/news",
    "/blog",
  ];

  const urls = paths.map((p) => `${competitor.url}${p}`);

  const results = await Promise.allSettled(
    urls.map((url) => scrapePage(competitor.name, url))
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<ScrapedPage> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value);
}

/**
 * Search for recent competitor news using Google search.
 * Falls back gracefully if search fails.
 */
async function searchCompetitorNews(
  competitorName: string
): Promise<NewsResult[]> {
  const queries = [
    `"${competitorName}" hockey new product launch ${new Date().getFullYear()}`,
    `"${competitorName}" hockey sponsorship deal`,
    `"${competitorName}" hockey patent`,
  ];

  const results: NewsResult[] = [];

  for (const query of queries) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      // Use a public search API (DuckDuckGo instant answers)
      const encodedQuery = encodeURIComponent(query);
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1`,
        { signal: controller.signal }
      );

      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();

        // Extract related topics as news results
        const topics = data.RelatedTopics ?? [];
        for (const topic of topics.slice(0, 3)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              competitor: competitorName,
              headline: topic.Text.slice(0, 200),
              source: "DuckDuckGo",
              snippet: topic.Text,
              url: topic.FirstURL,
            });
          }
        }
      }
    } catch {
      // Search failed for this query — continue with others
    }
  }

  return results;
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

  // Scrape all competitors concurrently
  const scanPromises = COMPETITORS.map(async (comp) => {
    const [pages, newsResults] = await Promise.all([
      scrapeCompetitor(comp),
      searchCompetitorNews(comp.name),
    ]);

    return {
      competitor: comp.name,
      pages,
      newsResults,
    };
  });

  const scans = await Promise.all(scanPromises);

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

    // Scraped pages
    const okPages = scan.pages.filter((p) => p.status === "ok");
    const failedPages = scan.pages.filter((p) => p.status === "error");

    if (okPages.length > 0) {
      lines.push(`\nScraped ${okPages.length} pages (${failedPages.length} failed):`);
      for (const page of okPages) {
        if (page.content.length > 50) {
          lines.push(`\n### ${page.title || page.url}`);
          lines.push(page.content.slice(0, 4000));
        }
      }
    } else {
      lines.push("\nNo pages could be scraped (site may block bots).");
    }

    // News results
    if (scan.newsResults.length > 0) {
      lines.push(`\n### Recent News & Mentions`);
      for (const news of scan.newsResults) {
        lines.push(`- ${news.headline}`);
        lines.push(`  Source: ${news.url}`);
      }
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n---\n\n");
}
