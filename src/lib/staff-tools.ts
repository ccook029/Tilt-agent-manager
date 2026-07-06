// ---------------------------------------------------------------------------
// Staff Tools — the operational back-office that lives in the tiltweb app
// (tilthockey.com/admin/*). Phase 2 of consolidation surfaces these directly
// from Corporate HQ. They still run in tiltweb (own admin auth), so we deep-
// link into them rather than embedding — one definition, used by both the
// header menu and the /staff landing page.
// ---------------------------------------------------------------------------

/**
 * Base URL of the tiltweb storefront/admin. Override per environment with
 * NEXT_PUBLIC_TILTWEB_URL; defaults to production.
 */
export const TILTWEB_URL = (
  process.env.NEXT_PUBLIC_TILTWEB_URL || "https://tilthockey.com"
).replace(/\/$/, "");

export function staffToolUrl(path: string): string {
  return `${TILTWEB_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface StaffTool {
  /** tiltweb admin path, e.g. "/admin/ambassadors". */
  path: string;
  name: string;
  description: string;
  /** Loose grouping for the landing page. */
  group: "Programs" | "Partners" | "Product" | "Team";
}

export const STAFF_TOOLS: StaffTool[] = [
  {
    path: "/admin/ambassadors",
    name: "Ambassadors",
    description: "Review applications, approve, and track announcement photos",
    group: "Programs",
  },
  {
    path: "/admin/registrations",
    name: "Stick Registrations",
    description: "Warranty registrations and owner records",
    group: "Programs",
  },
  {
    path: "/admin/partners",
    name: "Partners",
    description: "Wholesale + consignment partner accounts",
    group: "Partners",
  },
  {
    path: "/admin/retailers",
    name: "Retailers",
    description: "Retail sources, sell-through, and sales reports",
    group: "Partners",
  },
  {
    path: "/admin/retailers/onboarding",
    name: "Retailer Onboarding",
    description: "Invite, review, and issue partner agreements",
    group: "Partners",
  },
  {
    path: "/admin/teams",
    name: "Team Stores",
    description: "Team gear, colorways, and orders",
    group: "Product",
  },
  {
    path: "/admin/analytics",
    name: "Analytics",
    description: "Trends and insights across the storefront",
    group: "Product",
  },
  {
    path: "/admin/employees",
    name: "Employees",
    description: "Admin users and access",
    group: "Team",
  },
];

/** The handful of tools worth pinning in the header dropdown. */
export const STAFF_MENU_TOOLS: StaffTool[] = STAFF_TOOLS.filter((t) =>
  ["/admin/ambassadors", "/admin/retailers/onboarding", "/admin/partners", "/admin/retailers"].includes(
    t.path
  )
);
