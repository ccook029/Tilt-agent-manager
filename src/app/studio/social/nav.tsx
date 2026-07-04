"use client";

// ---------------------------------------------------------------------------
// Social Studio sub-nav — replaces the standalone app's SiteHeader now that
// the module lives inside HQ (the hub layout provides the global chrome).
// ---------------------------------------------------------------------------
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/studio/social", label: "Overview", exact: true },
  { href: "/studio/social/plan", label: "Plan" },
  { href: "/studio/social/posts", label: "Posts" },
  { href: "/studio/social/studio", label: "Studio" },
  { href: "/studio/social/catalog", label: "Catalog" },
  { href: "/studio/social/gaps", label: "Gaps" },
  { href: "/studio/social/setup", label: "Setup" },
];

export default function SocialNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="module-nav" aria-label="Social Studio">
      {TABS.map((t) => {
        const active = t.exact
          ? pathname === t.href
          : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={active ? "active" : ""}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
