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
import { fetchInvoices } from "@/lib/zoho";
import { fetchAllStickRecords } from "@/lib/zoho-sheet";
import { countSticksSold } from "@/lib/sticks-sold";
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
    stickRecordsResult,
  ] = await Promise.allSettled([
    fetchInvoices(currentRange.startDate, currentRange.endDate),
    fetchInvoices(previousRange.startDate, previousRange.endDate),
    fetchGA4Metrics(currentRange),
    fetchGA4Metrics(previousRange),
    fetchAllStickRecords(),
  ]);

  // --- Revenue & sticks sold from invoices ---
  let currentRevenue = 0;
  let previousRevenue = 0;
  let currentMonthSticks = 0;
  let previousMonthSticks = 0;
  let revenueError: string | undefined;

  if (currentInvoicesResult.status === "fulfilled") {
    for (const inv of currentInvoicesResult.value) {
      currentRevenue += inv.total;
    }
  } else {
    revenueError = currentInvoicesResult.reason?.message ?? "Failed to fetch invoices";
  }

  if (previousInvoicesResult.status === "fulfilled") {
    for (const inv of previousInvoicesResult.value) {
      previousRevenue += inv.total;
    }
  } else {
    revenueError = revenueError ?? previousInvoicesResult.reason?.message ?? "Failed to fetch invoices";
  }

  // --- Sticks sold, from the inventory sheet ---
  // One row per stick, so this counts sticks rather than SKU quantities, and
  // it's one read instead of a detail call per invoice.
  let stickError: string | undefined;
  let unreadableSoldDates = 0;
  if (stickRecordsResult.status === "fulfilled") {
    const records = stickRecordsResult.value;
    const cur = countSticksSold(records, currentRange.startDate, currentRange.endDate);
    const prev = countSticksSold(records, previousRange.startDate, previousRange.endDate);
    currentMonthSticks = cur.count;
    previousMonthSticks = prev.count;
    unreadableSoldDates = cur.unreadableDates;
  } else {
    stickError =
      stickRecordsResult.reason?.message ?? "Failed to read the inventory sheet";
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
      ...(stickError ? [{ source: "sheet", message: stickError }] : []),
      // A sheet full of unreadable sold-dates makes the count a floor rather
      // than a fact, so say so instead of quietly under-reporting.
      ...(unreadableSoldDates > 0
        ? [{
            source: "sheet",
            message: `${unreadableSoldDates} sold stick${
              unreadableSoldDates === 1 ? " has a date" : "s have dates"
            } that couldn't be read — the count is a floor.`,
          }]
        : []),
    ],
  };

  return NextResponse.json(response, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
