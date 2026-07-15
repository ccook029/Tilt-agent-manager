"use client";

// ---------------------------------------------------------------------------
// DepartmentsMenu — the header's business-area navigator.
//
// One dropdown organized the way the company is organized: each department
// with its boss, team size, and its tools/workspaces — all driven by the org
// directory, so the top bar, the home page, and /org always agree on where
// everything lives.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getDepartments,
  getEmployeesByDepartment,
  getEmployeeById,
} from "@/lib/org/directory";

const departments = getDepartments().map((d) => {
  const boss = d.managerId ? getEmployeeById(d.managerId) : undefined;
  const headcount = getEmployeesByDepartment(d.id).length;
  return {
    id: d.id,
    name: d.name,
    lead: boss ? `${boss.name} · ${headcount} on team` : `${headcount} reporting to leadership`,
    tools: d.tools ?? [],
  };
});

export default function DepartmentsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const pathname = usePathname();

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
        setStyle({ position: "fixed", top: r.bottom + 8, left: 12, right: 12, width: "auto", maxHeight: "70vh", overflowY: "auto" });
      } else {
        setStyle({ position: "fixed", top: r.bottom + 10, right: window.innerWidth - r.right, width: 340, maxHeight: "75vh", overflowY: "auto" });
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
        className="flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-300"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Departments
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
          className="z-[60] rounded-xl border border-gray-800 bg-[#101010]/95 p-2 shadow-2xl shadow-black/60 backdrop-blur-md"
        >
          <Link
            href="/org"
            className="block rounded-lg px-3 py-2 transition-colors hover:bg-gray-900"
          >
            <span className="text-sm font-medium text-gray-200">
              Full Org Chart
            </span>
            <span className="block text-xs text-gray-500">
              Everyone, who they report to, and department controls
            </span>
          </Link>
          {departments.map((d) => (
            <div key={d.id}>
              <div className="my-1 border-t border-gray-800/70" />
              <Link
                href={`/org#${d.id}`}
                className="block rounded-lg px-3 py-2 transition-colors hover:bg-gray-900"
              >
                <span className="text-sm font-semibold text-[#00d6ff]">
                  {d.name}
                </span>
                <span className="block text-xs text-gray-500">{d.lead}</span>
              </Link>
              {d.tools.map((t) =>
                t.external ? (
                  <a
                    key={t.href}
                    href={t.href}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg px-3 py-1.5 pl-6 transition-colors hover:bg-gray-900"
                  >
                    <span className="text-[13px] text-gray-300">{t.label} ↗</span>
                    <span className="block text-[11px] text-gray-600">
                      {t.description}
                    </span>
                  </a>
                ) : (
                  <Link
                    key={t.href}
                    href={t.href}
                    className="block rounded-lg px-3 py-1.5 pl-6 transition-colors hover:bg-gray-900"
                  >
                    <span className="text-[13px] text-gray-300">{t.label}</span>
                    <span className="block text-[11px] text-gray-600">
                      {t.description}
                    </span>
                  </Link>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
