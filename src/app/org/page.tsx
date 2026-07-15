"use client";

// ---------------------------------------------------------------------------
// /org — the company org chart + department controls.
//
// Per department: the boss and reporting lines (from the directory the engine
// actually enforces), a Dispatch button (the boss plans and hands out work),
// an Assign-work form (Chris gives any employee a work order directly), and
// the graduation toggle (auto-ship boss-approved work — off by default).
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Employee {
  id: string;
  name: string;
  title: string;
  departmentId: string;
  role: "manager" | "worker";
  reportsTo: string | null;
  skills: string[];
  staffed: boolean;
  enabled: boolean;
}
interface Department {
  id: string;
  name: string;
  mission: string;
  managerId: string | null;
  members: string[];
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

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
            Org Chart
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Every department, its boss, and who reports to whom. Dispatch a
            team, assign work directly, and graduate a department when its
            boss has earned auto-ship.
          </p>
        </div>
        <Link
          href="/review"
          className="rounded-lg border border-emerald-800/60 bg-emerald-900/20 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-900/40"
        >
          Review queue →
        </Link>
      </div>

      {/* Leadership root */}
      <div className="rounded-xl border border-[#0094b8]/40 bg-[#0094b8]/10 p-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#00d6ff]">
          Leadership
        </p>
        <p className="mt-1 text-sm text-gray-200">
          Chris Cook · Jeremy Elliott — Co-Founders
        </p>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          {departments.map((dept) => {
            const boss = dept.managerId ? employees[dept.managerId] : null;
            const members = dept.members
              .map((id) => employees[id])
              .filter(Boolean)
              .filter((e) => e.id !== dept.managerId);
            return (
              <div
                key={dept.id}
                className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-5"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-bold uppercase tracking-wide text-gray-100">
                      {dept.name}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">{dept.mission}</p>
                  </div>
                  {boss?.staffed && (
                    <DeptControls
                      dept={dept}
                      bossName={boss.name}
                      autoShip={autoShip[dept.id] === true}
                      onChanged={load}
                    />
                  )}
                </div>

                {boss ? (
                  <div className="mb-3">
                    <PersonRow employee={boss} isBoss />
                  </div>
                ) : (
                  <p className="mb-3 text-xs text-gray-600">
                    Reports directly to leadership (no department manager).
                  </p>
                )}

                {members.length > 0 && (
                  <div className="space-y-1.5 border-l border-gray-800 pl-4">
                    {members.map((e) => (
                      <PersonRow key={e.id} employee={e} />
                    ))}
                  </div>
                )}

                <AssignWorkForm
                  members={[boss, ...members]
                    .filter((e): e is Employee => Boolean(e))
                    .filter((e) => e.staffed && e.enabled)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
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
    setNote(null);
    try {
      const res = await fetch(`/api/org/departments/${dept.id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => ({}));
      setNote(
        res.ok
          ? `${bossName} dispatched ${d.dispatched ?? 0} — ${d.approved ?? 0} in your review queue.`
          : d.error ?? "Dispatch failed."
      );
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
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
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
      {note && <p className="max-w-[16rem] text-right text-[10px] text-gray-500">{note}</p>}
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
    if (!assignee || !title.trim() || !brief.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/org/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: assignee, title, brief, run: true }),
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
    <div className="mt-4 border-t border-gray-800/60 pt-3">
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
              placeholder="Title (e.g. 'Reel: X1 flex demo')"
              className="min-w-[14rem] flex-1 rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-xs text-gray-200 focus:border-[#00d6ff] focus:outline-none"
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
              disabled={busy || !assignee || !title.trim() || !brief.trim()}
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

function PersonRow({
  employee,
  isBoss,
}: {
  employee: Employee;
  isBoss?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          isBoss ? "bg-[#0094b8] text-white" : "bg-gray-800 text-gray-300"
        }`}
      >
        {employee.name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .slice(0, 2)}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm text-gray-200">
          {employee.name}
          {isBoss && (
            <span className="ml-2 rounded-full bg-[#0094b8]/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#00d6ff]">
              Boss
            </span>
          )}
        </p>
        <p className="truncate text-xs text-gray-500">{employee.title}</p>
      </div>
      {!employee.staffed && (
        <span className="ml-auto shrink-0 rounded-full border border-gray-700 px-2 py-0.5 text-[10px] text-gray-500">
          not staffed yet
        </span>
      )}
    </div>
  );
}
