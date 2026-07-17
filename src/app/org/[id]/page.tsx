"use client";

// ---------------------------------------------------------------------------
// /org/[id] — one consistent page for every employee.
//
// Whoever you click in the org chart lands here: who they are, an Assign-work
// box (title optional), their work history (with status + preview), their
// recent activity log, their department tools, and — if they're a boss — a
// Dispatch button. Replaces the old per-persona dashboard card so every
// employee has the same functionality.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { dispatchInBackground } from "@/lib/client/dispatch";
import { getPersonaByAgentId } from "@/lib/personas";
import GenericAgentChat from "@/components/generic-agent-chat";

// These three have richer dedicated chats on their legacy console
// (/dashboard/[id]) — the generic org chat stays out of their way.
const DEDICATED_CHAT = new Set(["accounting", "accounting-manager", "product-design"]);

interface Employee {
  id: string;
  name: string;
  title: string;
  departmentId: string;
  role: string;
  reportsTo: string | null;
  charter?: string;
  staffed: boolean;
}
interface DepartmentTool {
  label: string;
  href: string;
  description: string;
  external?: boolean;
}
interface Department {
  id: string;
  name: string;
  managerId: string | null;
  tools?: DepartmentTool[];
}
interface WorkRound {
  round: number;
  draft: string;
}
interface WorkOrder {
  id: string;
  title: string;
  status: string;
  deliverableType: string;
  createdAt: string;
  rounds: WorkRound[];
  error?: string;
}
interface RunLog {
  id: string;
  agentName: string;
  startedAt: string;
  status: string;
  output: string;
  tokensUsed?: number;
}

function statusTone(status: string): string {
  if (status === "approved" || status === "shipped") return "text-emerald-400 border-emerald-900/50";
  if (status === "escalated") return "text-amber-400 border-amber-900/50";
  if (status === "error") return "text-red-400 border-red-900/50";
  return "text-gray-400 border-gray-800";
}

function preview(order: WorkOrder): string {
  const draft = order.rounds[order.rounds.length - 1]?.draft ?? "";
  if (!draft.trim()) return order.error ? `Error: ${order.error}` : "";
  const email = draft.match(/```email\s*([\s\S]*?)```/i);
  if (email) {
    try {
      const arr = JSON.parse(email[1].trim());
      const subs = (Array.isArray(arr) ? arr : [arr]).map((i) => i.subject).filter(Boolean);
      if (subs.length) return `${subs.length} email(s): ${subs.join(" · ")}`.slice(0, 200);
    } catch { /* noop */ }
  }
  return draft
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export default function EmployeePage() {
  const params = useParams();
  const id = String(params.id);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [dir, wo, lg] = await Promise.all([
      fetch("/api/org/directory").then((r) => r.json()).catch(() => ({})),
      fetch(`/api/org/work-orders?assignee=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/agents/logs?agentId=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => ({})),
    ]);
    setEmployees(dir.employees ?? []);
    setDepartments(dir.departments ?? []);
    setOrders(wo.orders ?? []);
    setLogs(lg.logs ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const employee = useMemo(() => employees.find((e) => e.id === id), [employees, id]);
  const dept = useMemo(
    () => departments.find((d) => d.id === employee?.departmentId),
    [departments, employee]
  );
  const boss = useMemo(
    () => employees.find((e) => e.id === employee?.reportsTo),
    [employees, employee]
  );
  const isBoss = !!(dept && dept.managerId === id);
  // Legacy scheduled agents (Penny, Sterling, Maya, Dana, …) keep their
  // per-agent console at /dashboard/[id] — chat, Run Now, report files.
  // Staffed employees (assignHref) and external tools don't have one.
  const persona = getPersonaByAgentId(id);
  const hasConsole = !!persona && !persona.external && !persona.assignHref;
  const hasReports = useMemo(
    () => employees.some((e) => e.reportsTo === id && e.staffed),
    [employees, id]
  );

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-8 text-gray-500">Loading…</div>;
  }
  if (!employee) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-gray-400">No employee found for &quot;{id}&quot;.</p>
        <Link href="/org" className="mt-3 inline-block text-sm text-[#00d6ff] hover:underline">← Org chart</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${isBoss ? "bg-[#0094b8] text-white" : "bg-gray-800 text-gray-300"}`}>
            {employee.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold uppercase tracking-wide">{employee.name}</h1>
            <p className="text-sm text-gray-400">
              {employee.title}
              {isBoss && <span className="ml-2 rounded-full bg-[#0094b8]/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#00d6ff]">Boss</span>}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              <Link href={`/org#${employee.departmentId}`} className="hover:text-gray-300">{dept?.name ?? employee.departmentId}</Link>
              {boss ? <> · reports to {boss.name}</> : <> · reports to the founders</>}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasConsole && (
            <Link href={`/dashboard/${id}`} className="rounded-lg border border-[#0094b8]/40 bg-[#0094b8]/10 px-3 py-2 text-xs font-medium text-[#00d6ff] transition-colors hover:bg-[#0094b8]/20" title={`Chat with ${employee.name.split(" ")[0]}, trigger scheduled runs, and browse report files`}>Chat &amp; runs</Link>
          )}
          <Link href="/org" className="rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700">← Org chart</Link>
        </div>
      </div>

      {employee.charter && (
        <p className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-4 text-sm text-gray-400">{employee.charter}</p>
      )}

      {/* Chat is the primary way to work with an employee. Bosses come in
          already grounded in their team's recent output and can hand out
          agreed work via one-click assign cards. */}
      {employee.staffed && !DEDICATED_CHAT.has(id) && (
        <>
          <GenericAgentChat
            agentId={id}
            name={employee.name}
            greeting={
              isBoss && hasReports
                ? `Hey — it's ${employee.name.split(" ")[0]}. Ask me about the team's work and I'll give you the high level first — then we can drill into whatever's worth it. When we land on something to do, I'll set it up so you can assign it in one click.`
                : `Hey — it's ${employee.name.split(" ")[0]}. Ask me anything about my area, or talk through a piece of work before you assign it.`
            }
            placeholder={`Message ${employee.name.split(" ")[0]}…`}
          />
          <VoicePicker agentId={id} firstName={employee.name.split(" ")[0]} />
        </>
      )}

      {/* Direct assign form + (boss) dispatch */}
      <details className="group">
        <summary className="cursor-pointer select-none text-xs font-medium text-gray-500 transition-colors hover:text-gray-300">
          Assign work with a form instead ▾
        </summary>
        <div className="mt-2">
          <AssignWork employeeId={id} employeeName={employee.name} onDone={load} />
        </div>
      </details>
      {isBoss && hasReports && dept && (
        <DispatchTeam deptId={dept.id} bossName={employee.name} onDone={load} />
      )}

      {/* Tools */}
      {(dept?.tools?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Tools & workspaces</p>
          <div className="flex flex-wrap gap-2">
            {dept!.tools!.map((t) =>
              t.external ? (
                <a key={t.href} href={t.href} target="_blank" rel="noreferrer" title={t.description} className="rounded-full border border-gray-700 bg-gray-800/40 px-3 py-1 text-[11px] text-gray-300 hover:border-[#00d6ff]/50 hover:text-[#00d6ff]">{t.label} ↗</a>
              ) : (
                <Link key={t.href} href={t.href} title={t.description} className="rounded-full border border-gray-700 bg-gray-800/40 px-3 py-1 text-[11px] text-gray-300 hover:border-[#00d6ff]/50 hover:text-[#00d6ff]">{t.label}</Link>
              )
            )}
          </div>
        </div>
      )}

      {/* Work history */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Work — {orders.length}</h2>
        {orders.length === 0 ? (
          <p className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6 text-sm text-gray-400">Nothing yet. Assign work above and it&apos;ll show here (and, once done, in your Review queue).</p>
        ) : (
          orders.map((o) => <OrderCard key={o.id} order={o} />)
        )}
      </section>

      {/* Activity log */}
      {logs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Recent activity</h2>
          {logs.slice(0, 8).map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-lg border border-gray-800/50 bg-[#0d0d0d] px-3 py-2 text-xs">
              <span className={l.status === "success" ? "text-emerald-400" : "text-red-400"}>{l.status === "success" ? "✓" : "✗"}</span>
              <span className="truncate text-gray-400">{l.agentName}</span>
              <span className="ml-auto shrink-0 text-gray-600">{l.startedAt.slice(0, 10)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// Voice picker — assign any voice from the ElevenLabs account (premium and
// cloned voices included) to this employee. Hidden when ElevenLabs isn't
// configured; "Auto" uses the default pool.
function VoicePicker({ agentId, firstName }: { agentId: string; firstName: string }) {
  const [voices, setVoices] = useState<{ id: string; name: string; category: string }[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [companyDefault, setCompanyDefault] = useState<string>("");
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch("/api/agents/tts/voices")
      .then(async (r) => {
        if (r.status === 501) {
          setState("unconfigured");
          return;
        }
        const d = await r.json().catch(() => null);
        if (!r.ok || !d?.ok) {
          setLoadError(d?.error ?? `Failed (${r.status})`);
          setState("error");
          return;
        }
        setVoices(d.voices ?? []);
        setCurrent(d.map?.[agentId] ?? "");
        setCompanyDefault(d.map?.["default"] ?? "");
        setState("ok");
      })
      .catch(() => setState("error"));
  }, [agentId]);

  if (state === "loading") return null;
  if (state === "unconfigured") {
    return (
      <p className="px-1 text-[11px] text-gray-600">
        Custom voices aren&apos;t linked yet — add <code className="text-gray-400">ELEVENLABS_API_KEY</code> in
        Vercel and redeploy, then your ElevenLabs voices (including cloned ones) appear here.
      </p>
    );
  }
  if (state === "error") {
    return (
      <div className="space-y-1 px-1 text-[11px] text-amber-500/80">
        <p>
          Couldn&apos;t load your ElevenLabs voices — the API key may lack permission to list voices.
          Create a key with full access (or Voices: Read + Text-to-Speech) and update it in Vercel.
        </p>
        {loadError && <p className="text-gray-500">{loadError}</p>}
      </div>
    );
  }

  const save = async (id: string, voiceId: string) => {
    await fetch("/api/agents/tts/voices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: id, voiceId: voiceId || null }),
    }).catch(() => {});
  };

  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(null), 2500);
  };

  const pick = async (voiceId: string) => {
    setCurrent(voiceId);
    await save(agentId, voiceId);
    flash("saved ✓");
  };

  const setForEveryone = async () => {
    await save("default", current);
    setCompanyDefault(current);
    flash("set for the whole company ✓");
  };

  // Play a sample in the selected voice, strictly — no silent fallback, so a
  // real ElevenLabs problem (permissions, quota, missing voice) shows here.
  const testVoice = async () => {
    setTesting(true);
    setNote(null);
    try {
      const res = await fetch("/api/agents/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `Hey, it's ${firstName} from Tilt. This is exactly how I'll sound in chat.`,
          agentId,
          voiceId: current || undefined,
          strict: true,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setNote(d.error ?? `Test failed (${res.status})`);
        return;
      }
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      audio.onended = () => URL.revokeObjectURL(audio.src);
      await audio.play();
    } catch {
      setNote("Test failed — network error.");
    } finally {
      setTesting(false);
    }
  };

  const defaultName = voices.find((v) => v.id === companyDefault)?.name;

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] text-gray-500">
      <span>{firstName}&apos;s voice:</span>
      <select
        value={current}
        onChange={(e) => void pick(e.target.value)}
        className="rounded-md border border-gray-800 bg-[#0a0a0a] px-2 py-1 text-[11px] text-gray-300 focus:border-[#00d6ff] focus:outline-none"
      >
        <option value="">{defaultName ? `Auto (${defaultName})` : "Auto"}</option>
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.category === "cloned" ? " (cloned)" : ""}
          </option>
        ))}
      </select>
      <button
        onClick={() => void testVoice()}
        disabled={testing}
        className="rounded-full border border-gray-800 bg-gray-900/60 px-2.5 py-0.5 text-[11px] text-gray-400 transition-colors hover:border-[#00d6ff]/50 hover:text-[#00d6ff] disabled:opacity-50"
      >
        {testing ? "…" : "▶ Test"}
      </button>
      {current && current !== companyDefault && (
        <button
          onClick={() => void setForEveryone()}
          className="rounded-full border border-gray-800 bg-gray-900/60 px-2.5 py-0.5 text-[11px] text-gray-400 transition-colors hover:border-[#00d6ff]/50 hover:text-[#00d6ff]"
        >
          Use for everyone
        </button>
      )}
      {note && (
        <span className={note.startsWith("saved") || note.startsWith("set") ? "text-emerald-400" : "text-amber-500/90"}>
          {note}
        </span>
      )}
    </div>
  );
}

function AssignWork({ employeeId, employeeName, onDone }: { employeeId: string; employeeName: string; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    if (!brief.trim()) return;
    setBusy(true);
    setNote(null);
    const finalTitle = title.trim() || brief.trim().split(/\s+/).slice(0, 7).join(" ").slice(0, 60);
    try {
      const res = await fetch("/api/org/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: employeeId, title: finalTitle, brief, run: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const s = d.order?.status;
        setNote(s === "escalated" ? "Done — it raised a question in /review." : s === "error" ? "It errored — see below." : "Done — it's in your Review queue.");
        setBrief("");
        setTitle("");
        await onDone();
      } else {
        setNote(d.error ?? "Failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-xs text-gray-200 focus:border-[#00d6ff] focus:outline-none";
  return (
    <div className="space-y-2 rounded-xl border border-[#0094b8]/30 bg-[#0094b8]/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#00d6ff]">Assign work to {employeeName}</p>
      <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" disabled={busy} />
      <textarea className={input} rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="The brief — what you want, in your words. Their boss reviews it before it comes back to you." disabled={busy} />
      <div className="flex items-center gap-2">
        <button onClick={run} disabled={busy || !brief.trim()} className="rounded-md bg-[#0094b8] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#00a8d1] disabled:opacity-40">
          {busy ? "Working (takes a minute)…" : "Create & run"}
        </button>
        {note && <span className="text-[11px] text-gray-500">{note}</span>}
      </div>
    </div>
  );
}

function DispatchTeam({ deptId, bossName, onDone }: { deptId: string; bossName: string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setNote(`${bossName} is planning…`);
    const out = await dispatchInBackground(`/api/org/departments/${deptId}/dispatch`, {
      onProgress: (p) => {
        if (p.phase === "running" && p.completed === 0) setNote(`${bossName} dispatched ${p.planned} — the team is drafting…`);
        else if (p.phase === "running") setNote(`Working… ${p.completed}/${p.planned} done`);
      },
    });
    setNote(out.error ?? (out.planned === 0 ? "Nothing to dispatch this round." : `Done — ${out.approved} in your review queue${out.escalated ? `, ${out.escalated} escalated` : ""}.`));
    await onDone();
    setBusy(false);
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-800/60 bg-[#111]/40 p-4">
      <button onClick={run} disabled={busy} className="rounded-md bg-[#0094b8] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#00a8d1] disabled:opacity-50">
        {busy ? `${bossName} is working…` : "Dispatch team"}
      </button>
      <span className="text-[11px] text-gray-500">{note ?? `Let ${bossName} plan the period and hand work to the team.`}</span>
    </div>
  );
}

function OrderCard({ order }: { order: WorkOrder }) {
  const [open, setOpen] = useState(false);
  const draft = order.rounds[order.rounds.length - 1]?.draft;
  return (
    <div className="rounded-xl border border-gray-800/60 bg-[#0d0d0d] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-100">{order.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-400">{preview(order)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${statusTone(order.status)}`}>{order.status}</span>
          {draft && (
            <button onClick={() => setOpen((v) => !v)} className="text-[11px] text-gray-500 hover:text-gray-300">{open ? "hide" : "view"}</button>
          )}
        </div>
      </div>
      {open && draft && (
        <p className="mt-3 whitespace-pre-wrap rounded-lg border border-gray-800/60 bg-black/30 p-3 text-xs text-gray-300">{draft}</p>
      )}
    </div>
  );
}
