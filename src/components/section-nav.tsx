"use client";

// ---------------------------------------------------------------------------
// SectionNav — a section's tab strip, generated from the tool registry.
//
// Replaces per-section hand-written tab lists. Those were how four inventory
// tools ended up reachable ONLY from inside /inventory: the tab strip knew
// about them and nothing else did. Reading both from one registry means a tool
// can't be present in one navigation and missing from the other.
// ---------------------------------------------------------------------------
import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabsForSection } from "@/lib/org/tool-registry";

export default function SectionNav({
  section,
  ariaLabel,
}: {
  section: string;
  ariaLabel: string;
}) {
  const pathname = usePathname() ?? "";
  const tabs = tabsForSection(section);
  if (tabs.length === 0) return null;

  // The section root would otherwise light up on every child route.
  const roots = tabs.map((t) => t.href);
  const isActive = (href: string) => {
    const deeper = roots.some((r) => r !== href && r.startsWith(href + "/"));
    return deeper || href === pathname ? pathname === href : pathname.startsWith(href);
  };

  return (
    <nav
      className="flex gap-1 overflow-x-auto border-b border-gray-800/70 [&>*]:shrink-0"
      aria-label={ariaLabel}
    >
      {tabs.map((t) => {
        const active = isActive(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            title={t.description}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-[#00d6ff] text-[#00d6ff]"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.tabLabel}
          </Link>
        );
      })}
    </nav>
  );
}
