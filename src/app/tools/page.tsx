// ---------------------------------------------------------------------------
// /tools — every workspace in HQ, on one page.
//
// The catch-all for "I know we built that, I can't remember where it lives".
// Generated from the tool registry, so it can't fall behind the way a
// hand-written list does.
// ---------------------------------------------------------------------------
import Link from "next/link";
import { allGrouped, GROUP_LABELS, type Tool } from "@/lib/org/tool-registry";
import { getEmployeeById } from "@/lib/org/directory";

export const metadata = { title: "Tools — Tilt HQ" };

function ownerName(t: Tool): string | null {
  if (!t.ownerId) return null;
  return getEmployeeById(t.ownerId)?.name ?? null;
}

export default function ToolsIndexPage() {
  const groups = allGrouped();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-600">
          Tilt OS
        </p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight text-white">
          Everything in HQ
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Every workspace, grouped by what you&apos;re trying to do. Each one
          also lives on its owner&apos;s page in the org chart.
        </p>
      </div>

      <div className="space-y-10">
        {groups.map(({ group, tools }) => (
          <section key={group}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {GROUP_LABELS[group]}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {tools.map((t) => {
                const owner = ownerName(t);
                const card = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-semibold text-gray-100">{t.label}</span>
                      {t.external && (
                        <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
                          External
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-500">{t.description}</p>
                    {owner && (
                      <p className="mt-2 text-xs text-gray-600">{owner}</p>
                    )}
                  </>
                );
                return t.external ? (
                  <a
                    key={t.href}
                    href={t.href}
                    className="rounded-xl border border-gray-800/80 bg-[#101010]/80 p-4 transition-colors hover:border-[#0094b8]/50"
                  >
                    {card}
                  </a>
                ) : (
                  <Link
                    key={t.href}
                    href={t.href}
                    className="rounded-xl border border-gray-800/80 bg-[#101010]/80 p-4 transition-colors hover:border-[#0094b8]/50"
                  >
                    {card}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
