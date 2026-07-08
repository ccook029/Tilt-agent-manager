"use client";

// ---------------------------------------------------------------------------
// Stick Inventory sub-nav — replaces the standalone app's Header now that the
// module lives inside HQ (the hub layout provides the global chrome).
// ---------------------------------------------------------------------------
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/inventory", label: "Inventory", exact: true },
  { href: "/inventory/scan", label: "Scan & Sell" },
  { href: "/inventory/order-builder", label: "Order Builder" },
];

export default function InventoryNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      className="flex gap-1 border-b border-gray-800/70 overflow-x-auto [&>*]:shrink-0"
      aria-label="Stick Inventory"
    >
      {TABS.map((t) => {
        const active = t.exact
          ? pathname === t.href
          : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active
                ? "border-[#00d6ff] text-[#00d6ff]"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
