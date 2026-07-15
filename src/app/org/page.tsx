"use client";

// ---------------------------------------------------------------------------
// /org — the company org chart, straight from the directory data.
//
// Departments, their boss, and every employee's reporting line — the structure
// the engine actually enforces, made visible. "Not staffed yet" positions show
// as pending so the roadmap is legible.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import Link from "next/link";

interface Employee {
  id: string;
  name: string;
  title: string;
  departmentId: string;
  role: "manager" | "worker";
  reportsTo: string | null;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/org/directory")
      .then((r) => r.json())
      .then((d) => {
        setDepartments(d.departments ?? []);
        const map: Record<string, Employee> = {};
        for (const e of d.employees ?? []) map[e.id] = e;
        setEmployees(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">
            Org Chart
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Every department, its boss, and who reports to whom. Work flows up
            through the boss and stops at your desk for approval.
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
                <div className="mb-3">
                  <h2 className="font-display text-lg font-bold uppercase tracking-wide text-gray-100">
                    {dept.name}
                  </h2>
                  <p className="mt-1 text-xs text-gray-500">{dept.mission}</p>
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
              </div>
            );
          })}
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
