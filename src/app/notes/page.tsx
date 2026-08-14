"use client";

// ---------------------------------------------------------------------------
// /notes — things to remember.
//
// The capture box is the shared NoteCapture component, the same one on the HQ
// home page, so a note goes in identically wherever you happen to be. This page
// is the list: what's open, in reading order, with the late ones first.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import NoteCapture from "@/components/note-capture";

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
  const [showDone, setShowDone] = useState(false);

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
  }, [load]);

  async function toggle(note: Note) {
    // Optimistic: ticking something off should feel instant, and the reload
    // below puts it right if the write failed.
    setNotes((cur) => cur.map((n) => (n.id === note.id ? { ...n, done: !n.done } : n)));
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

      <div className="mb-6">
        <NoteCapture autoFocus onAdded={load} />
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
