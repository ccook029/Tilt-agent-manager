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
  const previousRange = monthRange(prevYear, prevMonth);

  // Fetch all data sources in parallel — each is optional
  const [
    currentInvoicesResult,
    previousInvoicesResult,
    ga4CurrentResult,
    ga4PreviousResult,
  ] = await Promise.allSettled([
    fetchInvoices(currentRange.startDate, currentRange.endDate),
    fetchInvoices(previousRange.startDate, previousRange.endDate),
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
    for (const inv of currentInvoicesResult.value) {
      currentRevenue += inv.total;
      for (const li of inv.line_items ?? []) {
        if (isStickSku(li.sku)) currentMonthSticks += li.quantity;
      }
    }
  } else {
    revenueError = currentInvoicesResult.reason?.message ?? "Failed to fetch invoices";
  }

  if (previousInvoicesResult.status === "fulfilled") {
    for (const inv of previousInvoicesResult.value) {
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

  const response = {
    generatedAt: now.toISOString(),
    currentMonth: {
      label: `${monthNames[currentMonth]} ${currentYear}`,
      revenue: Math.round(currentRevenue * 100) / 100,
      siteVisits: currentVisits,
      inquiries: currentInquiries,
    },
    previousMonth: {
      label: `${monthNames[prevMonth]} ${prevYear}`,
      revenue: Math.round(previousRevenue * 100) / 100,
      siteVisits: previousVisits,
      inquiries: previousInquiries,
    },
    sticksSold: {
      currentMonth: {
        label: `${monthNames[currentMonth]} ${currentYear}`,
        total: currentMonthSticks,
      },
      previousMonth: {
        label: `${monthNames[prevMonth]} ${prevYear}`,
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
