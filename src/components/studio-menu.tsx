"use client";

// ---------------------------------------------------------------------------
// StudioMenu — the "Design Studio" dropdown in the OS header. One place to
// reach every creative tool, whether native (Announcements) or an embedded
// module (Social Studio, Catalog Builder and its product-focused variants).
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  const btnRef = useRef<HTMLButtonElement>(null);
  // Viewport-relative panel position so it never runs off a phone screen
  // (the button sits mid-row, so anchoring to it can overflow either edge).
  const [style, setStyle] = useState<CSSProperties>({});
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

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      if (window.innerWidth < 640) {
        // Full-width sheet with equal screen margins, dropped below the button.
        setStyle({ position: "fixed", top: r.bottom + 8, left: 12, right: 12, width: "auto" });
      } else {
        // Desktop: aligned to the button's right edge, fixed width.
        setStyle({ position: "fixed", top: r.bottom + 10, right: window.innerWidth - r.right, width: 288 });
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
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
          style={style}
          className="rounded-xl border border-gray-800 bg-[#101010]/95 backdrop-blur-md shadow-2xl shadow-black/60 p-2 z-[60]"
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
