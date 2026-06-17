// ---------------------------------------------------------------------------
// ga4.ts — Google Analytics 4 Data Pipeline
//
// Authenticates via service account, pulls metrics and dimensions for a
// given date range, and returns formatted text ready for prompt injection.
// ---------------------------------------------------------------------------
import { BetaAnalyticsDataClient } from "@google-analytics/data";

/** Build an authenticated GA4 client from base64-encoded service account JSON. */
function getClient(): BetaAnalyticsDataClient {
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credentialsJson) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON env var is not set");
  }

  const credentials = JSON.parse(
    Buffer.from(credentialsJson, "base64").toString("utf-8")
  );

  return new BetaAnalyticsDataClient({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    projectId: credentials.project_id,
  });
}

function getPropertyId(): string {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error("GA4_PROPERTY_ID env var is not set");
  return id;
}

// ---- Public types ---------------------------------------------------------

export interface GA4DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface GA4Report {
  overview: string;
  bySource: string;
  byPage: string;
  byDevice: string;
  byGeo: string;
}

// ---- Core fetch -----------------------------------------------------------

/**
 * Pull GA4 data for the given date range and return a formatted text block
 * suitable for injecting into a prompt's {{ga_data}} variable.
 */
export async function fetchGA4Data(range: GA4DateRange): Promise<string> {
  const client = getClient();
  const property = `properties/${getPropertyId()}`;

  // Run overview + dimension reports concurrently
  const [overview, sourceReport, pageReport, deviceReport, geoReport] =
    await Promise.all([
      fetchOverview(client, property, range),
      fetchByDimension(client, property, range, "sessionSource", "sessionMedium"),
      fetchByDimension(client, property, range, "pagePath"),
      fetchByDimension(client, property, range, "deviceCategory"),
      fetchByDimension(client, property, range, "country", "region"),
    ]);

  return [
    "## Overview Metrics",
    overview,
    "",
    "## Traffic by Source / Medium",
    sourceReport,
    "",
    "## Top Pages",
    pageReport,
    "",
    "## Device Breakdown",
    deviceReport,
    "",
    "## Geographic Breakdown",
    geoReport,
  ].join("\n");
}

/**
 * Fetch raw numeric metrics for a date range.
 * Returns sessions and conversions as numbers.
 * Revenue comes from Zoho Books, not GA4.
 */
export async function fetchGA4Metrics(
  range: GA4DateRange
): Promise<{ sessions: number; conversions: number }> {
  const client = getClient();
  const property = `properties/${getPropertyId()}`;

  const [response] = await client.runReport({
    property,
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    metrics: [
      { name: "sessions" },
      { name: "conversions" },
    ],
  });

  const row = response.rows?.[0];
  return {
    sessions: Number(row?.metricValues?.[0]?.value ?? "0"),
    conversions: Number(row?.metricValues?.[1]?.value ?? "0"),
  };
}

// ---- Internal helpers -----------------------------------------------------

// Note: purchaseRevenue is intentionally NOT requested. GA4 must convert
// transaction currency (CAD) to the property's reporting currency (USD), and
// the exchange rate for the most recent day often isn't published yet at the
// 8 AM ET run time, which makes GA4 return INVALID_ARGUMENT and fails the whole
// pipeline. Revenue is sourced from Zoho Books instead (see hq-metrics route).
const METRICS = [
  "sessions",
  "totalUsers",
  "newUsers",
  "engagementRate",
  "averageSessionDuration",
  "screenPageViews",
  "conversions",
];

async function fetchOverview(
  client: BetaAnalyticsDataClient,
  property: string,
  range: GA4DateRange
): Promise<string> {
  const [response] = await client.runReport({
    property,
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    metrics: METRICS.map((name) => ({ name })),
  });

  if (!response.rows || response.rows.length === 0) {
    return "(no data)";
  }

  const row = response.rows[0];
  const lines = METRICS.map((metric, i) => {
    const value = row.metricValues?.[i]?.value ?? "0";
    return `${formatMetricName(metric)}: ${formatMetricValue(metric, value)}`;
  });

  return lines.join("\n");
}

async function fetchByDimension(
  client: BetaAnalyticsDataClient,
  property: string,
  range: GA4DateRange,
  ...dimensionNames: string[]
): Promise<string> {
  const [response] = await client.runReport({
    property,
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    dimensions: dimensionNames.map((name) => ({ name })),
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "engagementRate" },
      { name: "conversions" },
    ],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 15,
  });

  if (!response.rows || response.rows.length === 0) {
    return "(no data)";
  }

  // Build a simple text table
  const header = [
    ...dimensionNames.map(formatMetricName),
    "Sessions",
    "Users",
    "Engagement",
    "Conversions",
  ];

  const rows = response.rows.map((row) => [
    ...row.dimensionValues!.map((d) => d.value ?? "(not set)"),
    row.metricValues![0]?.value ?? "0",
    row.metricValues![1]?.value ?? "0",
    formatPercent(row.metricValues![2]?.value ?? "0"),
    row.metricValues![3]?.value ?? "0",
  ]);

  return formatTable(header, rows);
}

// ---- Formatting helpers ---------------------------------------------------

function formatMetricName(name: string): string {
  // camelCase → Title Case
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function formatMetricValue(metric: string, value: string): string {
  if (metric === "engagementRate") return formatPercent(value);
  if (metric === "averageSessionDuration") return `${parseFloat(value).toFixed(1)}s`;
  return parseFloat(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPercent(value: string): string {
  return `${(parseFloat(value) * 100).toFixed(1)}%`;
}

function formatTable(header: string[], rows: string[][]): string {
  const allRows = [header, ...rows];
  const colWidths = header.map((_, i) =>
    Math.max(...allRows.map((row) => (row[i] ?? "").length))
  );

  const pad = (str: string, width: number) => str.padEnd(width);
  const separator = colWidths.map((w) => "-".repeat(w)).join(" | ");

  const headerLine = header.map((h, i) => pad(h, colWidths[i])).join(" | ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => pad(cell, colWidths[i])).join(" | ")
  );

  return [headerLine, separator, ...dataLines].join("\n");
}

// ---- Date helpers (exported for use by route handlers) --------------------

/**
 * Get the reporting period and its comparison period for the daily report.
 *
 * Schedule: Mon–Fri at 8 AM ET (12:00 UTC).
 *  - Tuesday–Friday: report covers the previous day, compared to the same
 *    weekday one week earlier.
 *  - Monday: report covers Saturday + Sunday (the weekend), compared to
 *    the prior Saturday + Sunday.
 */
export function getDailyReportRanges(now: Date): {
  current: GA4DateRange;
  prior: GA4DateRange;
  label: string;
} {
  const day = now.getDay(); // 0=Sun … 6=Sat

  if (day === 1) {
    // Monday → report on Sat + Sun
    const sunday = addDays(now, -1);
    const saturday = addDays(now, -2);
    const priorSunday = addDays(sunday, -7);
    const priorSaturday = addDays(saturday, -7);
    return {
      current: { startDate: toYMD(saturday), endDate: toYMD(sunday) },
      prior: { startDate: toYMD(priorSaturday), endDate: toYMD(priorSunday) },
      label: "Weekend",
    };
  }

  // Tue–Fri → report on yesterday vs same day last week
  const yesterday = addDays(now, -1);
  const priorDay = addDays(yesterday, -7);
  return {
    current: { startDate: toYMD(yesterday), endDate: toYMD(yesterday) },
    prior: { startDate: toYMD(priorDay), endDate: toYMD(priorDay) },
    label: yesterday.toLocaleDateString("en-US", { weekday: "long" }),
  };
}

/** Get Monday–Sunday date range for the week containing the given date. */
export function getWeekRange(referenceDate: Date): GA4DateRange {
  const d = new Date(referenceDate);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    startDate: toYMD(monday),
    endDate: toYMD(sunday),
  };
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}
