"use client";

// ---------------------------------------------------------------------------
// StudioMenu — the "Design Studio" dropdown in the OS header. One place to
// reach every creative tool, whether native (Announcements) or an embedded
// module (Social Studio, Catalog Builder and its product-focused variants).
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const STUDIO_TOOLS = [
  {
    href: "/studio/social",
    name: "Social Content",
    description: "Plan + draft the social calendar",
  },
  {
    href: "/studio/announcements",
    name: "Announcement Creator",
    description: "Draft an on-brand announcement",
  },
  {
    href: "/studio/catalog",
    name: "Catalog Builder",
    description: "Full team-colorway catalog",
  },
  {
    href: "/studio/blanket",
    name: "Blanket Fundraiser",
    description: "Team blanket renders for fundraisers",
  },
  {
    href: "/studio/sox",
    name: "SOX Creator",
    description: "Team sock renders",
  },
] as const;

export default function StudioMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const active = pathname?.startsWith("/studio");

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-sm transition-colors flex items-center gap-1 ${
          active ? "text-[#00d6ff]" : "text-gray-500 hover:text-gray-300"
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Design Studio
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-3 w-72 rounded-xl border border-gray-800 bg-[#101010]/95 backdrop-blur-md shadow-2xl shadow-black/60 p-2 z-[60]"
        >
          <Link
            href="/studio"
            className="block rounded-lg px-3 py-2 hover:bg-gray-900 transition-colors"
          >
            <span className="text-sm font-medium text-gray-200">
              Studio Home
            </span>
            <span className="block text-xs text-gray-500">
              All creative tools in one place
            </span>
          </Link>
          <div className="my-1 border-t border-gray-800/70" />
          {STUDIO_TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="block rounded-lg px-3 py-2 hover:bg-gray-900 transition-colors"
            >
              <span className="text-sm font-medium text-gray-200">{t.name}</span>
              <span className="block text-xs text-gray-500">{t.description}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
