// ---------------------------------------------------------------------------
// /staff — the Staff Tools home: the tiltweb back office, reachable from HQ.
// Each tool still runs in tiltweb (tilthockey.com/admin/*) with its own admin
// sign-in, so these are deep links that open in a new tab. Phase 2 of pulling
// the storefront operations into Corporate HQ.
// ---------------------------------------------------------------------------
import type { Metadata } from "next";
import { STAFF_TOOLS, staffToolUrl, TILTWEB_URL, type StaffTool } from "@/lib/staff-tools";

export const metadata: Metadata = { title: "Staff Tools" };

const GROUP_ORDER: StaffTool["group"][] = ["Programs", "Partners", "Product", "Team"];

const GROUP_ACCENT: Record<StaffTool["group"], string> = {
  Programs: "text-[#00d6ff] border-cyan-900/60",
  Partners: "text-amber-400 border-amber-900/60",
  Product: "text-emerald-400 border-emerald-900/60",
  Team: "text-violet-400 border-violet-900/60",
};

function ExternalArrow() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" className="text-gray-600 group-hover:text-[#00d6ff] transition-colors" aria-hidden>
      <path
        d="M3 9l6-6M4.5 3H9v4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function StaffPage() {
  const prettyHost = TILTWEB_URL.replace(/^https?:\/\//, "");

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-widest text-gray-600">Tilt OS</p>
        <h1 className="text-3xl font-semibold">Staff Tools</h1>
        <p className="text-gray-500 mt-1 max-w-2xl">
          The storefront back office — ambassadors, partners, retailers, and
          registrations — now reachable straight from HQ. These run in the{" "}
          <span className="text-gray-400">{prettyHost}</span> admin and open in a
          new tab; sign in there with your staff account.
        </p>
      </div>

      {GROUP_ORDER.map((group) => {
        const tools = STAFF_TOOLS.filter((t) => t.group === group);
        if (tools.length === 0) return null;
        return (
          <section key={group} className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="h-5 w-1 rounded-full bg-[#00d6ff]" />
              <h2 className="font-display text-lg font-semibold uppercase tracking-wide text-gray-300">
                {group}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tools.map((t) => (
                <a
                  key={t.path}
                  href={staffToolUrl(t.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5 hover:border-[#00d6ff]/60 hover:bg-[#121212] transition-colors flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold group-hover:text-[#00d6ff] transition-colors">
                      {t.name}
                    </h3>
                    <span
                      className={`text-[10px] uppercase tracking-wider border rounded-full px-2 py-0.5 ${GROUP_ACCENT[t.group]}`}
                    >
                      {t.group}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {t.description}
                  </p>
                  <span className="mt-auto pt-2 flex items-center gap-1.5 text-xs text-gray-600 group-hover:text-gray-400 transition-colors">
                    Open in tiltweb <ExternalArrow />
                  </span>
                </a>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
