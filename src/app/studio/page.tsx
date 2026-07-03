// ---------------------------------------------------------------------------
// /studio — the Design Studio home: every creative tool in one place.
// Native tools run in-app; module tools embed their own deployments through
// the authenticated launch routes.
// ---------------------------------------------------------------------------
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Design Studio" };

const TOOLS: {
  href: string;
  name: string;
  blurb: string;
  tag: string;
  accent: string;
}[] = [
  {
    href: "/studio/social",
    name: "Social Content",
    blurb:
      "The Social Studio — a living 6-month content plan, drafted posts with platform copy, branded visuals, and the shot list of missing assets.",
    tag: "Module",
    accent: "text-pink-400 border-pink-900/60",
  },
  {
    href: "/studio/announcements",
    name: "Announcement Creator",
    blurb:
      "Tell it what's happening — a drop, a sale, a partnership, a milestone — and get on-brand announcement copy for every platform plus a visual brief.",
    tag: "Native",
    accent: "text-[#00d6ff] border-cyan-900/60",
  },
  {
    href: "/studio/catalog",
    name: "Catalog Builder",
    blurb:
      "Team name + colors + a logo in, a full team-colorway Tilt catalog out — rendered product shots assembled into the master catalog PDF.",
    tag: "Module",
    accent: "text-amber-400 border-amber-900/60",
  },
  {
    href: "/studio/blanket",
    name: "Blanket Fundraiser",
    blurb:
      "The Catalog Builder focused on one thing: team-branded blanket renders, ready for fundraiser one-pagers and order forms.",
    tag: "Module",
    accent: "text-emerald-400 border-emerald-900/60",
  },
  {
    href: "/studio/sox",
    name: "SOX Creator",
    blurb:
      "Team sock renders in the team's colors — the quickest merch win for any team conversation.",
    tag: "Module",
    accent: "text-violet-400 border-violet-900/60",
  },
];

export default function StudioPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-widest text-gray-600">
          Tilt OS
        </p>
        <h1 className="text-3xl font-semibold">Design Studio</h1>
        <p className="text-gray-500 mt-1 max-w-2xl">
          Every creative tool under one roof. Modules run on their own
          deployments but live here — launched with your staff session, and
          everything they produce flows back into the Morning Brief.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5 hover:border-[#00d6ff]/60 hover:bg-[#121212] transition-colors flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold group-hover:text-[#00d6ff] transition-colors">
                {t.name}
              </h2>
              <span
                className={`text-[10px] uppercase tracking-wider border rounded-full px-2 py-0.5 ${t.accent}`}
              >
                {t.tag}
              </span>
            </div>
            <p className="text-sm text-gray-500 leading-relaxed">{t.blurb}</p>
            <span className="mt-auto pt-2 text-xs text-gray-600 group-hover:text-gray-400 transition-colors">
              Open →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
