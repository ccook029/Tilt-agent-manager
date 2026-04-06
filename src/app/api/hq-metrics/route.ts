// GET /api/hq-metrics — JSON summary for Master HQ dashboard
//
// Returns current month and previous month numbers for:
//   - revenue (from Zoho Sales Orders)
//   - site visits (GA4 sessions)
//   - inquiries (GA4 conversions)
//
// Publicly accessible, no auth required.

import { NextResponse } from "next/server";
import { fetchRecentSalesOrders } from "@/lib/zoho";
import { fetchGA4Metrics, type GA4DateRange } from "@/lib/ga4";

export const maxDuration = 60;

/** YYYY-MM-DD formatter */
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Get the first and last day of a month (0-indexed month). */
function monthRange(year: number, month: number): GA4DateRange {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0); // last day of month
  return { startDate: fmt(start), endDate: fmt(end) };
}

export async function GET() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;

  const currentRange = monthRange(currentYear, currentMonth);
  const previousRange = monthRange(prevYear, prevMonth);

  // Fetch all data sources in parallel — each is optional
  const [zohoResult, ga4CurrentResult, ga4PreviousResult] =
    await Promise.allSettled([
      fetchRecentSalesOrders(62), // ~2 months of orders
      fetchGA4Metrics(currentRange),
      fetchGA4Metrics(previousRange),
    ]);

  // --- Revenue from Zoho Sales Orders ---
  let currentRevenue = 0;
  let previousRevenue = 0;
  let revenueError: string | undefined;

  if (zohoResult.status === "fulfilled") {
    const orders = zohoResult.value;
    const currentStart = currentRange.startDate;
    const currentEnd = currentRange.endDate;
    const prevStart = previousRange.startDate;
    const prevEnd = previousRange.endDate;

    for (const order of orders) {
      if (order.date >= currentStart && order.date <= currentEnd) {
        currentRevenue += order.total;
      } else if (order.date >= prevStart && order.date <= prevEnd) {
        previousRevenue += order.total;
      }
    }
  } else {
    revenueError = zohoResult.reason?.message ?? "Failed to fetch sales orders";
  }

  // --- Site visits & inquiries from GA4 ---
  let currentVisits = 0;
  let currentInquiries = 0;
  let previousVisits = 0;
  let previousInquiries = 0;
  let ga4Error: string | undefined;

  if (ga4CurrentResult.status === "fulfilled") {
    currentVisits = ga4CurrentResult.value.sessions;
    currentInquiries = ga4CurrentResult.value.conversions;
  } else {
    ga4Error = ga4CurrentResult.reason?.message ?? "Failed to fetch GA4 data";
  }

  if (ga4PreviousResult.status === "fulfilled") {
    previousVisits = ga4PreviousResult.value.sessions;
    previousInquiries = ga4PreviousResult.value.conversions;
  } else {
    ga4Error =
      ga4Error ?? ga4PreviousResult.reason?.message ?? "Failed to fetch GA4 data";
  }

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
    changes: {
      revenue: previousRevenue > 0
        ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 1000) / 10
        : null,
      siteVisits: previousVisits > 0
        ? Math.round(((currentVisits - previousVisits) / previousVisits) * 1000) / 10
        : null,
      inquiries: previousInquiries > 0
        ? Math.round(((currentInquiries - previousInquiries) / previousInquiries) * 1000) / 10
        : null,
    },
    errors: [
      ...(revenueError ? [{ source: "zoho", message: revenueError }] : []),
      ...(ga4Error ? [{ source: "ga4", message: ga4Error }] : []),
    ],
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
