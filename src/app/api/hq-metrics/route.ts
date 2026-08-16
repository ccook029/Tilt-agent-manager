// GET /api/hq-metrics — JSON summary for Master HQ dashboard
//
// Returns current month and previous month numbers for:
//   - revenue (from Zoho Inventory invoices, excluding void/draft)
//   - site visits (GA4 sessions)
//   - inquiries (0 until a real source is wired up)
//   - sticks sold this month vs last month (TILT- SKUs from invoice line items)
//
// Publicly accessible, no auth required.

import { NextResponse } from "next/server";
import { fetchInvoicesWithLineItems } from "@/lib/zoho";
import { fetchGA4Metrics, type GA4DateRange } from "@/lib/ga4";

export const maxDuration = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Handle CORS preflight requests. */
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** YYYY-MM-DD formatter */
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Get the first and last day of a month (0-indexed month).
 *  If capToday is provided, caps the end date to that date. */
function monthRange(year: number, month: number, capToday?: Date): GA4DateRange {
  const start = new Date(year, month, 1);
  let end = new Date(year, month + 1, 0); // last day of month
  if (capToday && end > capToday) end = capToday;
  return { startDate: fmt(start), endDate: fmt(end) };
}

/**
 * The same slice of the previous month as has elapsed this month.
 *
 * The comparison used to be month-to-date against the WHOLE previous month, so
 * on the 14th a flat business read as roughly a 55% collapse — and the number
 * got worse the earlier in the month you looked. Fourteen days against fourteen
 * days is the only version that means anything.
 *
 * Clamped to the previous month's length so the 31st compares against the 30th
 * rather than spilling forward.
 */
export function priorMonthToDate(
  year: number,
  month: number,
  dayOfMonth: number
): GA4DateRange {
  const start = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = new Date(year, month, Math.min(dayOfMonth, lastDay));
  return { startDate: fmt(start), endDate: fmt(end) };
}

/** Check if a SKU is a stick (all stick SKUs start with TILT-). */
function isStickSku(sku: string): boolean {
  return sku.toUpperCase().startsWith("TILT-");
}

export async function GET() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;

  const currentRange = monthRange(currentYear, currentMonth, now); // cap to today
  // Like-for-like: the same number of days into the previous month.
  const previousRange = priorMonthToDate(prevYear, prevMonth, now.getDate());

  // Fetch all data sources in parallel — each is optional
  const [
    currentInvoicesResult,
    previousInvoicesResult,
    ga4CurrentResult,
    ga4PreviousResult,
  ] = await Promise.allSettled([
    fetchInvoicesWithLineItems(currentRange.startDate, currentRange.endDate),
    fetchInvoicesWithLineItems(previousRange.startDate, previousRange.endDate),
    fetchGA4Metrics(currentRange),
    fetchGA4Metrics(previousRange),
  ]);

  // --- Revenue & sticks sold from invoices ---
  let currentRevenue = 0;
  let previousRevenue = 0;
  let currentMonthSticks = 0;
  let previousMonthSticks = 0;
  let revenueError: string | undefined;

  if (currentInvoicesResult.status === "fulfilled") {
    for (const inv of currentInvoicesResult.value.invoices) {
      currentRevenue += inv.total;
      for (const li of inv.line_items ?? []) {
        if (isStickSku(li.sku)) currentMonthSticks += li.quantity;
      }
    }
  } else {
    revenueError = currentInvoicesResult.reason?.message ?? "Failed to fetch invoices";
  }

  if (previousInvoicesResult.status === "fulfilled") {
    for (const inv of previousInvoicesResult.value.invoices) {
      previousRevenue += inv.total;
      for (const li of inv.line_items ?? []) {
        if (isStickSku(li.sku)) previousMonthSticks += li.quantity;
      }
    }
  } else {
    revenueError = revenueError ?? previousInvoicesResult.reason?.message ?? "Failed to fetch invoices";
  }

  // --- Site visits from GA4 ---
  let currentVisits = 0;
  let previousVisits = 0;
  let ga4Error: string | undefined;

  if (ga4CurrentResult.status === "fulfilled") {
    currentVisits = ga4CurrentResult.value.sessions;
  } else {
    ga4Error = ga4CurrentResult.reason?.message ?? "Failed to fetch GA4 data";
  }

  if (ga4PreviousResult.status === "fulfilled") {
    previousVisits = ga4PreviousResult.value.sessions;
  } else {
    ga4Error = ga4Error ?? ga4PreviousResult.reason?.message ?? "Failed to fetch GA4 data";
  }

  // --- Inquiries: no real source yet, return 0 ---
  const currentInquiries = 0;
  const previousInquiries = 0;

  // --- Build response ---
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // The comparison window, spelled out. "vs July" would be a lie now that it
  // means July 1–14; a reader who can't see the window can't judge the number.
  const day = now.getDate();
  const prevLastDay = new Date(prevYear, prevMonth + 1, 0).getDate();
  const prevDay = Math.min(day, prevLastDay);
  const isPartial = day < new Date(currentYear, currentMonth + 1, 0).getDate();
  const previousLabel = isPartial
    ? `${monthNames[prevMonth]} 1\u2013${prevDay}`
    : `${monthNames[prevMonth]} ${prevYear}`;
  const currentLabel = isPartial
    ? `${monthNames[currentMonth]} 1\u2013${day}`
    : `${monthNames[currentMonth]} ${currentYear}`;

  const response = {
    generatedAt: now.toISOString(),
    currentMonth: {
      label: currentLabel,
      revenue: Math.round(currentRevenue * 100) / 100,
      siteVisits: currentVisits,
      inquiries: currentInquiries,
    },
    previousMonth: {
      label: previousLabel,
      revenue: Math.round(previousRevenue * 100) / 100,
      siteVisits: previousVisits,
      inquiries: previousInquiries,
    },
    sticksSold: {
      currentMonth: {
        label: currentLabel,
        total: currentMonthSticks,
      },
      previousMonth: {
        label: previousLabel,
        total: previousMonthSticks,
      },
      change: previousMonthSticks > 0
        ? Math.round(((currentMonthSticks - previousMonthSticks) / previousMonthSticks) * 1000) / 10
        : null,
    },
    changes: {
      revenue: previousRevenue > 0
        ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 1000) / 10
        : null,
      siteVisits: previousVisits > 0
        ? Math.round(((currentVisits - previousVisits) / previousVisits) * 1000) / 10
        : null,
      inquiries: null,
    },
    errors: [
      ...(revenueError ? [{ source: "zoho", message: revenueError }] : []),
      ...(ga4Error ? [{ source: "ga4", message: ga4Error }] : []),
    ],
  };

  return NextResponse.json(response, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
