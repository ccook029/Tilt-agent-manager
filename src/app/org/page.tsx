"use client";

// ---------------------------------------------------------------------------
// /org — the company, laid out the way it actually runs.
//
// Reads top-down like a command structure: the founders, then Reese (Chief of
// Staff — the hub every manager reports to), then each department as a card:
// boss on top, reports beneath with connector lines, and a plain-language
// "what they do" line for every person. The machinery (dispatch, graduation,
// assign-work) is tucked behind "Team actions" so the structure reads first.
// Tap anyone to open their office — chat, work history, live wiring check.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { dispatchInBackground } from "@/lib/client/dispatch";

interface Employee {
  id: string;
  name: string;
  title: string;
  departmentId: string;
  role: "manager" | "worker";
  reportsTo: string | null;
  personaId?: string;
  skills: string[];
  charter?: string;
  staffed: boolean;
  enabled: boolean;
}
interface DeptTool {
  label: string;
  href: string;
  description: string;
  external?: boolean;
}
interface Department {
  id: string;
  name: string;
  mission: string;
  managerId: string | null;
  members: string[];
  tools?: DeptTool[];
}

// Narrative order: money → making → selling → growing → telling → building →
// caring → the site → the numbers. (Executive renders as the hub, not a card.)
const DEPT_ORDER = [
  "finance",
  "operations",
  "sales",
  "bizdev",
  "marketing",
  "product",
  "cx",
  "web",
  "intelligence",
];

// A distinct accent per department so the eye can anchor.
const DEPT_ACCENT: Record<string, { dot: string; border: string }> = {
  finance: { dot: "bg-emerald-400", border: "border-emerald-900/40" },
  operations: { dot: "bg-cyan-400", border: "border-cyan-900/40" },
  sales: { dot: "bg-orange-400", border: "border-orange-900/40" },
  bizdev: { dot: "bg-amber-400", border: "border-amber-900/40" },
  marketing: { dot: "bg-rose-400", border: "border-rose-900/40" },
  product: { dot: "bg-purple-400", border: "border-purple-900/40" },
  cx: { dot: "bg-teal-400", border: "border-teal-900/40" },
  web: { dot: "bg-sky-400", border: "border-sky-900/40" },
  intelligence: { dot: "bg-blue-400", border: "border-blue-900/40" },
};

/** First sentence of a charter, tightened to one legible line. */
function jobLine(e: Employee): string {
  const src = e.charter?.trim() || "";
  if (!src) return e.skills.slice(0, 3).join(" · ");
  const sentence = src.split(/(?<=[.!?])\s+/)[0] ?? src;
  return sentence.length > 110 ? `${sentence.slice(0, 107)}…` : sentence;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);
}

export default function OrgPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Record<string, Employee>>({});
  const [autoShip, setAutoShip] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [dir, settings] = await Promise.all([
      fetch("/api/org/directory").then((r) => r.json()).catch(() => ({})),
      fetch("/api/org/settings").then((r) => r.json()).catch(() => ({})),
    ]);
    setDepartments(dir.departments ?? []);
    const map: Record<string, Employee> = {};
    for (const e of dir.employees ?? []) map[e.id] = e;
    setEmployees(map);
    setAutoShip(settings.autoShip ?? {});
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chief = employees["chief-of-staff"];
  const ordered = useMemo(() => {
    const byId = new Map(departments.map((d) => [d.id, d]));
    const inOrder = DEPT_ORDER.map((id) => byId.get(id)).filter(
      (d): d is Department => Boolean(d)
    );
    // Anything new/unknown (except executive, which renders as the hub) lands at the end.
    const extras = departments.filter(
      (d) => d.id !== "executive" && !DEPT_ORDER.includes(d.id)
    );
    return [...inOrder, ...extras];
  }, [departments]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
            The Company
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Tap anyone to open their office — chat, assign work, see everything
            they&apos;ve done, and test the data they run on.
          </p>
        </div>
        <Link
          href="/review"
          className="rounded-lg border border-emerald-800/60 bg-emerald-900/20 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-900/40"
        >
          Review queue →
        </Link>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <>
          {/* ---- The chain of command: You → Reese → the departments ---- */}
          <div className="flex flex-col items-center">
            <div className="w-full max-w-md rounded-xl border border-[#0094b8]/40 bg-[#0094b8]/10 p-3.5 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#00d6ff]">
                Founders
              </p>
              <p className="mt-0.5 text-sm font-medium text-gray-100">
                Chris Cook · Jeremy Elliott
              </p>
              <p className="text-[11px] text-gray-500">
                Every decision trigger ends here.
              </p>
            </div>

            <div className="h-5 w-px bg-gray-700" />

            {chief ? (
              <Link
                href="/org/chief-of-staff"
                className="w-full max-w-md rounded-xl border border-gray-700 bg-[#111]/70 p-3.5 text-center transition-colors hover:border-[#00d6ff]/50"
              >
                <div className="flex items-center justify-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0094b8] text-xs font-bold text-white">
                    {initials(chief.name)}
                  </span>
                  <span className="text-left">
                    <span className="block text-sm font-semibold text-gray-100">
                      {chief.name} — Chief of Staff
                    </span>
                    <span className="block text-[11px] text-gray-500">
                      Runs the whole team for you. Every manager below reports to
                      him. Ask him anything, by chat or voice.
                    </span>
                  </span>
                </div>
              </Link>
            ) : null}

            <div className="h-5 w-px bg-gray-700" />
          </div>

          {/* ---- Department index ----
              Eleven expanded cards is a wall to scroll. This sits directly
              under the founders and Reese: every department, its colour, and
              who's in it, in one glance — then jump to the one you want. */}
          <DeptIndex departments={ordered} employees={employees} />

          {/* ---- Departments ---- */}
          <div className="grid gap-4 md:grid-cols-2">
            {ordered.map((dept) => (
              <DeptCard
                key={dept.id}
                dept={dept}
                employees={employees}
                autoShip={autoShip[dept.id] === true}
                onChanged={load}
              />
            ))}
          </div>

          <RhythmCard />
        </>
      )}
    </div>
  );
}

// ---- Company rhythm — the standing schedule -------------------------------

interface RhythmJobView {
  id: string;
  label: string;
  schedule: string;
  description: string;
  on: boolean;
}

function RhythmCard() {
  const [jobs, setJobs] = useState<RhythmJobView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/org/rhythm")
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs ?? []))
      .catch(() => {});
  }, []);

  const toggle = async (job: RhythmJobView) => {
    setBusy(job.id);
    try {
      await fetch("/api/org/rhythm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id, on: !job.on }),
      });
      setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, on: !j.on } : j)));
    } finally {
      setBusy(null);
    }
  };

  if (jobs.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-4">
      <h2 className="font-display text-base font-bold uppercase tracking-wide text-gray-100">
        Company rhythm
      </h2>
      <p className="mt-0.5 text-[11px] text-gray-500">
        Standing duties that run on their own — results land in your review
        queue (and your phone) like any other work. Toggle any of them off.
      </p>
      <ul className="mt-3 space-y-2.5">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-gray-200">
                {j.label}
                <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-600">
                  {j.schedule}
                </span>
              </p>
              <p className="text-[11px] leading-snug text-gray-500">{j.description}</p>
            </div>
            <button
              onClick={() => toggle(j)}
              disabled={busy === j.id}
              className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                j.on
                  ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300"
                  : "border-gray-700 text-gray-500 hover:border-gray-500"
              }`}
            >
              {j.on ? "On" : "Off"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Department index -------------------------------------------------------

/**
 * The whole org on one screen. Colour is the through-line: the dot here is the
 * same dot on the department's card and it's what makes eleven departments
 * scannable rather than a list of headings.
 */
function DeptIndex({
  departments,
  employees,
}: {
  departments: Department[];
  employees: Record<string, Employee>;
}) {
  if (departments.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-4">
      <h2 className="font-display text-base font-bold uppercase tracking-wide text-gray-100">
        Who&apos;s who
      </h2>
      <p className="mt-0.5 text-[11px] text-gray-500">
        Every department and who&apos;s in it. Click a name to work with them.
      </p>

      <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((dept) => {
          const accent = DEPT_ACCENT[dept.id] ?? { dot: "bg-gray-500", border: "border-gray-800/60" };
          const boss = dept.managerId ? employees[dept.managerId] : null;
          const people = [
            ...(boss ? [boss] : []),
            ...dept.members
              .map((id) => employees[id])
              .filter((e): e is Employee => Boolean(e))
              .filter((e) => e.id !== dept.managerId && e.enabled),
          ].filter((e) => e.staffed);

          if (people.length === 0) return null;

          return (
            <div key={dept.id} className="min-w-0">
              <a
                href={`#${dept.id}`}
                className="flex items-center gap-2 hover:opacity-80"
                title={dept.mission}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
                <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-gray-300">
                  {dept.name}
                </span>
              </a>
              <ul className="mt-1.5 space-y-1 border-l border-gray-800/70 pl-3">
                {people.map((e) => (
                  <li key={e.id} className="min-w-0">
                    <Link
                      href={`/org/${e.id}`}
                      className="group block truncate"
                      title={e.charter ?? e.title}
                    >
                      <span className="text-xs text-gray-200 group-hover:text-[#00d6ff]">
                        {e.name}
                      </span>
                      {e.id === dept.managerId && (
                        <span className="ml-1.5 text-[9px] uppercase tracking-wide text-[#00d6ff]/70">
                          lead
                        </span>
                      )}
                      <span className="block truncate text-[10px] leading-tight text-gray-600">
                        {e.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- One department card ----------------------------------------------------

function DeptCard({
  dept,
  employees,
  autoShip,
  onChanged,
}: {
  dept: Department;
  employees: Record<string, Employee>;
  autoShip: boolean;
  onChanged: () => Promise<void>;
}) {
  const accent = DEPT_ACCENT[dept.id] ?? { dot: "bg-gray-500", border: "border-gray-800/60" };
  const boss = dept.managerId ? employees[dept.managerId] : null;
  const reports = dept.members
    .map((id) => employees[id])
    .filter(Boolean)
    .filter((e) => e.id !== dept.managerId && e.enabled);
  const staffedAll = [boss, ...reports].filter(
    (e): e is Employee => Boolean(e && e.staffed && e.enabled)
  );
  const hasStaffedReports = reports.some((e) => e.staffed);

  return (
    <div
      id={dept.id}
      className={`scroll-mt-24 rounded-xl border ${accent.border} bg-[#111]/40 p-4`}
    >
      <div className="mb-3 flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold uppercase tracking-wide text-gray-100">
            {dept.name}
          </h2>
          <p className="text-[11px] leading-snug text-gray-500">{dept.mission}</p>
        </div>
      </div>

      {boss ? (
        <PersonRow employee={boss} isBoss />
      ) : (
        <p className="mb-1 text-[11px] text-gray-600">
          Reports directly to leadership (no manager).
        </p>
      )}

      {reports.length > 0 && (
        <div className="ml-4 mt-1 space-y-0.5 border-l border-gray-800 pl-3">
          {reports.map((e) => (
            <PersonRow key={e.id} employee={e} />
          ))}
        </div>
      )}

      {/* The machinery, tucked away so the structure reads first. */}
      {staffedAll.length > 0 && (
        <details className="group mt-3 border-t border-gray-800/60 pt-2">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-gray-500 transition-colors hover:text-gray-300">
            Team actions{" "}
            <span className="text-gray-700">
              — dispatch, assign work{dept.tools?.length ? ", tools" : ""} ▾
            </span>
          </summary>
          <div className="mt-2.5 space-y-3">
            {boss?.staffed && hasStaffedReports && (
              <DeptControls
                dept={dept}
                bossName={boss.name}
                autoShip={autoShip}
                onChanged={onChanged}
              />
            )}
            {(dept.tools?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {dept.tools!.map((t) =>
                  t.external ? (
                    <a
                      key={t.href}
                      href={t.href}
                      target="_blank"
                      rel="noreferrer"
                      title={t.description}
                      className="rounded-full border border-gray-700 bg-gray-800/40 px-2.5 py-1 text-[10px] text-gray-300 transition-colors hover:border-[#00d6ff]/50 hover:text-[#00d6ff]"
                    >
                      {t.label} ↗
                    </a>
                  ) : (
                    <Link
                      key={t.href}
                      href={t.href}
                      title={t.description}
                      className="rounded-full border border-gray-700 bg-gray-800/40 px-2.5 py-1 text-[10px] text-gray-300 transition-colors hover:border-[#00d6ff]/50 hover:text-[#00d6ff]"
                    >
                      {t.label}
                    </Link>
                  )
                )}
              </div>
            )}
            <AssignWorkForm members={staffedAll} />
          </div>
        </details>
      )}
    </div>
  );
}

// ---- Person row -------------------------------------------------------------

function PersonRow({ employee, isBoss }: { employee: Employee; isBoss?: boolean }) {
  return (
    <Link
      href={`/org/${employee.id}`}
      className="block rounded-lg px-1.5 py-1.5 transition-colors hover:bg-gray-900/60"
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            isBoss ? "bg-[#0094b8] text-white" : "bg-gray-800 text-gray-300"
          }`}
        >
          {initials(employee.name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm leading-tight text-gray-200">
            {employee.name}
            <span className="ml-1.5 text-[11px] text-gray-500">· {employee.title}</span>
            {isBoss && (
              <span className="ml-1.5 rounded-full bg-[#0094b8]/20 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[#00d6ff]">
                Boss
              </span>
            )}
            {!employee.staffed && (
              <span className="ml-1.5 rounded-full border border-gray-700 px-1.5 py-0.5 text-[9px] text-gray-500">
                not staffed
              </span>
            )}
          </p>
          <p className="truncate text-[11px] leading-snug text-gray-500">{jobLine(employee)}</p>
        </div>
      </div>
    </Link>
  );
}

// ---- Department controls: dispatch + graduation ----------------------------

function DeptControls({
  dept,
  bossName,
  autoShip,
  onChanged,
}: {
  dept: Department;
  bossName: string;
  autoShip: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const dispatch = async () => {
    setBusy("dispatch");
    setNote(`${bossName} is planning…`);
    try {
      const outcome = await dispatchInBackground(
        `/api/org/departments/${dept.id}/dispatch`,
        {
          onProgress: (p) => {
            if (p.phase === "running" && p.completed === 0) {
              setNote(`${bossName} dispatched ${p.planned} — the team is drafting…`);
            } else if (p.phase === "running") {
              setNote(`Working… ${p.completed}/${p.planned} done`);
            }
          },
        }
      );
      if (outcome.error) {
        setNote(outcome.error);
      } else if (outcome.planned === 0) {
        setNote(`${bossName} had nothing to dispatch this round.`);
      } else {
        const parts = [
          `${outcome.approved} in your review queue`,
          outcome.shipped ? `${outcome.shipped} auto-shipped` : "",
          outcome.escalated ? `${outcome.escalated} escalated` : "",
          outcome.errored ? `${outcome.errored} errored` : "",
        ].filter(Boolean);
        setNote(`Done — ${parts.join(", ")}.`);
      }
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  const toggleGraduation = async () => {
    setBusy("grad");
    try {
      await fetch("/api/org/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: dept.id, autoShip: !autoShip }),
      });
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={dispatch}
          disabled={busy !== null}
          className="rounded-md bg-[#0094b8] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#00a8d1] disabled:opacity-50"
        >
          {busy === "dispatch" ? `${bossName} is working…` : "Dispatch team"}
        </button>
        <button
          onClick={toggleGraduation}
          disabled={busy !== null}
          title={
            autoShip
              ? "Boss-approved work ships automatically. Click to restore your approve trigger."
              : "You approve everything before it ships. Click to let the boss ship approved work without you."
          }
          className={`rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
            autoShip
              ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300"
              : "border-gray-700 text-gray-400 hover:border-gray-500"
          }`}
        >
          {autoShip ? "Graduated ✓" : "Owner gate on"}
        </button>
      </div>
      {note && <p className="text-[10px] text-gray-500">{note}</p>}
    </div>
  );
}

// ---- Assign work directly ---------------------------------------------------

function AssignWorkForm({ members }: { members: Employee[] }) {
  const [open, setOpen] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (members.length === 0) return null;

  const submit = async () => {
    if (!assignee || !brief.trim()) return;
    setBusy(true);
    setNote(null);
    // Title is optional — derive a short one from the brief when left blank.
    const finalTitle =
      title.trim() || brief.trim().split(/\s+/).slice(0, 7).join(" ").slice(0, 60);
    try {
      const res = await fetch("/api/org/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: assignee, title: finalTitle, brief, run: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const status = d.order?.status;
        setNote(
          status === "approved" || status === "shipped"
            ? "Done — it's in your review queue."
            : status === "escalated"
              ? "Done — it raised a question for you in /review."
              : "Work order created."
        );
        setTitle("");
        setBrief("");
      } else {
        setNote(d.error ?? "Failed to create the work order.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-[11px] font-medium text-[#00d6ff] hover:underline"
        >
          + Assign work to this team
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-xs text-gray-200 focus:border-[#00d6ff] focus:outline-none"
              disabled={busy}
            >
              <option value="">Who does it?</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.title}
                </option>
              ))}
            </select>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="min-w-[12rem] flex-1 rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-xs text-gray-200 focus:border-[#00d6ff] focus:outline-none"
              disabled={busy}
            />
          </div>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="The brief — what you want, in your words. Their boss reviews it before it comes back to you."
            rows={2}
            className="w-full rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-xs text-gray-200 focus:border-[#00d6ff] focus:outline-none"
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={busy || !assignee || !brief.trim()}
              className="rounded-md bg-[#0094b8] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#00a8d1] disabled:opacity-40"
            >
              {busy ? "Working (takes a minute)…" : "Create & run"}
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={busy}
              className="text-[11px] text-gray-500 hover:text-gray-300"
            >
              cancel
            </button>
            {note && <span className="text-[11px] text-gray-500">{note}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
