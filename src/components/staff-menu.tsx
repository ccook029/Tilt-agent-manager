"use client";

// ---------------------------------------------------------------------------
// StaffMenu — the "Staff Tools" dropdown in the OS header. Deep-links into the
// tiltweb back office (tilthockey.com/admin/*), which runs as its own app with
// its own admin sign-in. Opens in a new tab so HQ stays put. The full grid
// lives at /staff.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { STAFF_MENU_TOOLS, staffToolUrl } from "@/lib/staff-tools";

export default function StaffMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const pathname = usePathname();
  const active = pathname?.startsWith("/staff");

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
        setStyle({ position: "fixed", top: r.bottom + 8, left: 12, right: 12, width: "auto" });
      } else {
        setStyle({ position: "fixed", top: r.bottom + 10, right: window.innerWidth - r.right, width: 300 });
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
        Staff Tools
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
            href="/staff"
            className="block rounded-lg px-3 py-2 hover:bg-gray-900 transition-colors"
          >
            <span className="text-sm font-medium text-gray-200">Staff Home</span>
            <span className="block text-xs text-gray-500">
              Every back-office tool in one place
            </span>
          </Link>
          <div className="my-1 border-t border-gray-800/70" />
          {STAFF_MENU_TOOLS.map((t) => (
            <a
              key={t.path}
              href={staffToolUrl(t.path)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start justify-between gap-2 rounded-lg px-3 py-2 hover:bg-gray-900 transition-colors"
            >
              <span>
                <span className="text-sm font-medium text-gray-200">{t.name}</span>
                <span className="block text-xs text-gray-500">{t.description}</span>
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                className="mt-1 shrink-0 text-gray-600"
                aria-hidden
              >
                <path
                  d="M3 9l6-6M4.5 3H9v4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
