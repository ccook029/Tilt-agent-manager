"use client";

// ---------------------------------------------------------------------------
// NotesNav — the notes icon in the header.
//
// A note with a date is a promise the system made to remember something. The
// badge is that promise being visible from anywhere in HQ rather than only on
// the page you'd have to think to open.
//
// It counts OVERDUE only, not everything open. A permanent badge showing a
// dozen notes is wallpaper within a week; a badge that's usually absent means
// something when it appears.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import Link from "next/link";

export default function NotesNav() {
  const [overdue, setOverdue] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      fetch("/api/notes")
        .then((r) => r.json())
        .then((j) => {
          if (!cancelled && j.ok) setOverdue(j.counts?.overdue ?? 0);
        })
        .catch(() => {});
    };
    read();
    // Cheap re-read when you come back to the tab, so ticking something off on
    // /notes doesn't leave a stale badge sitting in the header.
    const onFocus = () => read();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <Link
      href="/notes"
      title={overdue > 0 ? `Notes — ${overdue} overdue` : "Notes"}
      aria-label={overdue > 0 ? `Notes, ${overdue} overdue` : "Notes"}
      className="relative flex items-center text-gray-500 transition-colors hover:text-[#00d6ff]"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2" />
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M9 12h6M9 16h4" />
      </svg>
      {overdue > 0 && (
        <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500/90 px-1 text-[10px] font-bold leading-none text-white">
          {overdue > 9 ? "9+" : overdue}
        </span>
      )}
    </Link>
  );
}
