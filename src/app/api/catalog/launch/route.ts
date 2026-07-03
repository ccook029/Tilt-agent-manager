// ---------------------------------------------------------------------------
// GET /api/catalog/launch — Redirect to the Catalog Builder tool
//
// Catalog Builder (tilt-catalog-agent) is a standalone deployed app whose
// render/discover/classify endpoints are gated by a shared secret. We build the
// target URL SERVER-SIDE so the access key never ships in the client bundle,
// append it as ?key=... and 302-redirect the browser there. The tool reads the
// key once, stores it in sessionStorage, scrubs it from the visible URL, and
// then sends it on every request as the X-Catalog-Key header.
//
// Env:
//   NEXT_PUBLIC_CATALOG_URL  — public base URL of the catalog tool (safe to commit)
//   CATALOG_ACCESS_KEY       — server-only shared secret (NO NEXT_PUBLIC_ prefix).
//                              Must match the tilt-catalog-agent project's value.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

// Never cache the redirect — the Location carries the access key.
export const dynamic = "force-dynamic";

const FALLBACK_CATALOG_URL = "https://tilt-catalog-agent.vercel.app/";

export function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_CATALOG_URL ?? FALLBACK_CATALOG_URL;
  const key = process.env.CATALOG_ACCESS_KEY ?? "";

  // URL.searchParams handles encoding (equivalent to encodeURIComponent).
  const target = new URL(base);
  target.searchParams.set("key", key);

  // Deep-link passthrough for the Design Studio's product-focused tools
  // (Blanket Fundraiser, SOX Creator): the catalog app preselects `product`
  // and shows `title` as its heading.
  for (const param of ["product", "title"]) {
    const v = request.nextUrl.searchParams.get(param);
    if (v) target.searchParams.set(param, v);
  }

  return NextResponse.redirect(target.toString());
}
