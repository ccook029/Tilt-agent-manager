"use client";

// ---------------------------------------------------------------------------
// /notes — things to remember.
//
// The design constraint is capture speed. If adding a note here is slower than
// the app it replaces, it doesn't get used and the feature is worthless — so
// the box is the first thing on the page, it's focused on load, Enter saves,
// and everything else (urgency, a date, handing it to an agent) is optional and
// out of the way until wanted.
//
// Whose note it is sticks between adds, remembered in this browser, because in
// practice one person adds several in a row and re-picking every time is the
// friction that kills it.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";

interface Note {
  id: string;
  text: string;
  owner: "chris" | "jeremy";
  urgency: "low" | "normal" | "high";
  dueOn?: string;
  done: boolean;
  createdAt: string;
  workOrderId?: string;
  assignedToName?: string;
}

interface Employee {
  id: string;
  name: string;
  title: string;
  staffed?: boolean;
}

const OWNERS = [
  { id: "chris", name: "Chris" },
  { id: "jeremy", name: "Jeremy" },
] as const;

const URGENCIES = [
  { id: "high", label: "High" },
  { id: "normal", label: "Normal" },
  { id: "low", label: "Low" },
] as const;

const OWNER_KEY = "tilt-notes-owner";

function todayNumber(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function dayNum(iso?: string): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
}

function dueLabel(note: Note): { text: string; tone: string } | null {
  const due = dayNum(note.dueOn);
  if (due === null) return null;
  const today = todayNumber();
  if (due < today) return { text: `Overdue — ${note.dueOn}`, tone: "text-red-300" };
  if (due === today) return { text: "Due today", tone: "text-amber-300" };
  return { text: `Due ${note.dueOn}`, tone: "text-gray-500" };
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState<"chris" | "jeremy">("chris");
  const [urgency, setUrgency] = useState<"low" | "normal" | "high">("normal");
  const [dueOn, setDueOn] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [showExtras, setShowExtras] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const j = await fetch("/api/notes").then((r) => r.json());
      if (j.ok) setNotes(j.notes ?? []);
    } catch {
      /* the list is a convenience; adding reports its own errors */
    }
  }, []);

  useEffect(() => {
    void load();
    try {
      const saved = localStorage.getItem(OWNER_KEY);
      if (saved === "chris" || saved === "jeremy") setOwner(saved);
    } catch {
      /* ignore */
    }
    inputRef.current?.focus();
    // The agent list is only needed for the optional hand-off, so a failure
    // here must not stop notes being written.
    fetch("/api/org/directory")
      .then((r) => r.json())
      .then((j) => setEmployees((j.employees ?? []).filter((e: Employee) => e.staffed)))
      .catch(() => {});
  }, [load]);

  function pickOwner(id: "chris" | "jeremy") {
    setOwner(id);
    try {
      localStorage.setItem(OWNER_KEY, id);
    } catch {
      /* ignore */
    }
  }

  async function add() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const j = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: body,
          owner,
          urgency,
          dueOn: dueOn || undefined,
          assignTo: assignTo || undefined,
        }),
      }).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || "Couldn't save that.");
      setText("");
      setDueOn("");
      setUrgency("normal");
      setAssignTo("");
      setShowExtras(false);
      if (j.warning) setError(j.warning);
      await load();
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(note: Note) {
    setNotes((cur) =>
      cur.map((n) => (n.id === note.id ? { ...n, done: !n.done } : n))
    );
    await fetch("/api/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: note.id, done: !note.done }),
    }).catch(() => {});
    void load();
  }

  async function remove(note: Note) {
    if (!confirm(`Delete "${note.text.slice(0, 60)}"?`)) return;
    await fetch(`/api/notes?id=${encodeURIComponent(note.id)}`, { method: "DELETE" });
    void load();
  }

  const open = notes.filter((n) => !n.done);
  const done = notes.filter((n) => n.done);
  const overdue = open.filter((n) => {
    const d = dayNum(n.dueOn);
    return d !== null && d < todayNumber();
  }).length;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-200">Notes</h2>
        <p className="mt-1 text-sm text-gray-500">
          Things to remember. Anything with a date shows up in the daily brief
          when it&apos;s due or late.
          {overdue > 0 && (
            <span className="text-red-300"> {overdue} overdue right now.</span>
          )}
        </p>
      </div>

      {/* Capture — first thing on the page, focused on load, Enter saves. */}
      <div className="mb-6 rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-4">
        <div className="flex gap-2">
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/10">
            {OWNERS.map((o) => (
              <button
                key={o.id}
                onClick={() => pickOwner(o.id)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  owner === o.id
                    ? "bg-[#0094b8]/20 text-[#00d6ff]"
                    : "text-gray-500 hover:bg-white/[0.04]"
                }`}
              >
                {o.name}
              </button>
            ))}
          </div>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder="Something to remember…"
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-[#0094b8]/50 focus:outline-none"
          />
          <button
            onClick={() => void add()}
            disabled={busy || !text.trim()}
            className="shrink-0 rounded-lg border border-[#0094b8]/40 bg-[#0094b8]/10 px-4 py-2 text-xs font-medium text-[#00d6ff] hover:bg-[#0094b8]/20 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Add"}
          </button>
        </div>

        <button
          onClick={() => setShowExtras((v) => !v)}
          className="mt-2 text-xs text-gray-600 hover:text-gray-400"
        >
          {showExtras ? "− Less" : "+ Urgency, date, or hand it to an agent"}
        </button>

        {showExtras && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/5 pt-3">
            <div className="flex overflow-hidden rounded-lg border border-white/10">
              {URGENCIES.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setUrgency(u.id)}
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    urgency === u.id
                      ? "bg-white/[0.08] text-gray-200"
                      : "text-gray-600 hover:bg-white/[0.04]"
                  }`}
                >
                  {u.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Follow up
              <input
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-gray-300 focus:border-[#0094b8]/50 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Hand to
              <select
                value={assignTo}
                onChange={(e) => setAssignTo(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-gray-300 focus:border-[#0094b8]/50 focus:outline-none"
              >
                <option value="">nobody — just a note</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.title}
                  </option>
                ))}
              </select>
            </label>
            {assignTo && (
              <span className="text-xs text-amber-300/80">
                Creates a real work order, not just a note.
              </span>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
      </div>

      {open.length === 0 ? (
        <p className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-6 text-center text-sm text-gray-600">
          Nothing to remember. Enjoy it.
        </p>
      ) : (
        <div className="space-y-2">
          {open.map((n) => (
            <NoteRow key={n.id} note={n} onToggle={toggle} onDelete={remove} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowDone((v) => !v)}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            {showDone ? "− Hide" : "+ Show"} {done.length} done
          </button>
          {showDone && (
            <div className="mt-2 space-y-2">
              {done.map((n) => (
                <NoteRow key={n.id} note={n} onToggle={toggle} onDelete={remove} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoteRow({
  note,
  onToggle,
  onDelete,
}: {
  note: Note;
  onToggle: (n: Note) => void;
  onDelete: (n: Note) => void;
}) {
  const due = dueLabel(note);
  return (
    <div
      className={`group flex items-start gap-3 rounded-xl border p-3 ${
        note.done
          ? "border-gray-900 bg-[#0c0c0c]/60 opacity-60"
          : "border-gray-800/80 bg-[#101010]/80"
      }`}
    >
      <button
        onClick={() => onToggle(note)}
        aria-label={note.done ? "Mark not done" : "Mark done"}
        className={`mt-0.5 h-4 w-4 shrink-0 rounded border transition-colors ${
          note.done
            ? "border-[#0094b8] bg-[#0094b8]/40"
            : "border-gray-600 hover:border-[#00d6ff]"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${note.done ? "text-gray-600 line-through" : "text-gray-200"}`}>
          {note.text}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-600">
            {note.owner === "chris" ? "Chris" : "Jeremy"}
          </span>
          {note.urgency === "high" && !note.done && (
            <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">High</span>
          )}
          {due && !note.done && <span className={due.tone}>{due.text}</span>}
          {note.assignedToName && (
            <span className="text-[#00d6ff]/70">→ {note.assignedToName}</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onDelete(note)}
        className="shrink-0 text-xs text-gray-700 opacity-0 transition-opacity hover:text-gray-400 group-hover:opacity-100"
      >
        Delete
      </button>
    </div>
  );
}
