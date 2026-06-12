// ---------------------------------------------------------------------------
// Tilt Web staff metrics client
//
// Pulls the staff-portal sales metrics from the Tilt website (tiltweb) —
// sales broken down by product category and by channel (website checkout vs
// retailer portal). The website exposes a JSON endpoint gated by a shared
// secret; we call it server-side so the key never ships in the client bundle
// (same pattern as the Catalog Builder integration).
//
// Env:
//   TILT_WEB_METRICS_URL — full URL of the staff metrics endpoint on tiltweb,
//                          e.g. https://tilthockey.com/api/staff/metrics
//   TILT_WEB_METRICS_KEY — server-only shared secret (NO NEXT_PUBLIC_ prefix),
//                          sent as the X-Tilt-Metrics-Key header. Must match
//                          the value set in the tiltweb project exactly.
//
// Expected response shape from tiltweb (previousMonth uses the same shape):
// {
//   "currentMonth": {
//     "label": "June 2026",
//     "categories": [ { "name": "Senior Sticks", "units": 42, "revenue": 8400 } ],
//     "channels":   [ { "name": "Website", "units": 30, "revenue": 6000 },
//                     { "name": "Retailer Portal", "units": 12, "revenue": 2400 } ]
//   },
//   "previousMonth": { ... }
// }
// Unknown fields are ignored and malformed rows are dropped, so tiltweb can
// evolve the payload without breaking this dashboard.
// ---------------------------------------------------------------------------

export interface TiltWebBreakdownRow {
  name: string;
  units: number;
  revenue: number;
}

export interface TiltWebMonth {
  label: string;
  categories: TiltWebBreakdownRow[];
  channels: TiltWebBreakdownRow[];
}

export interface TiltWebMetrics {
  currentMonth: TiltWebMonth;
  previousMonth: TiltWebMonth;
}

export function isTiltWebConfigured(): boolean {
  return Boolean(process.env.TILT_WEB_METRICS_URL && process.env.TILT_WEB_METRICS_KEY);
}

function parseRows(value: unknown): TiltWebBreakdownRow[] {
  if (!Array.isArray(value)) return [];
  const rows: TiltWebBreakdownRow[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const { name, units, revenue } = raw as Record<string, unknown>;
    if (typeof name !== "string" || name.length === 0) continue;
    rows.push({
      name,
      units: typeof units === "number" && Number.isFinite(units) ? units : 0,
      revenue: typeof revenue === "number" && Number.isFinite(revenue) ? revenue : 0,
    });
  }
  return rows;
}

function parseMonth(value: unknown): TiltWebMonth {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    label: typeof raw.label === "string" ? raw.label : "",
    categories: parseRows(raw.categories),
    channels: parseRows(raw.channels),
  };
}

export async function fetchTiltWebMetrics(): Promise<TiltWebMetrics> {
  const url = process.env.TILT_WEB_METRICS_URL;
  const key = process.env.TILT_WEB_METRICS_KEY;
  if (!url || !key) {
    throw new Error("Tilt Web metrics not configured (TILT_WEB_METRICS_URL / TILT_WEB_METRICS_KEY)");
  }

  const res = await fetch(url, {
    headers: { "X-Tilt-Metrics-Key": key },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Tilt Web metrics request failed: ${res.status} ${res.statusText}`);
  }

  const body: unknown = await res.json();
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return {
    currentMonth: parseMonth(raw.currentMonth),
    previousMonth: parseMonth(raw.previousMonth),
  };
}
