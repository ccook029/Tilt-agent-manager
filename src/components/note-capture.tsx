"use client";

// ---------------------------------------------------------------------------
// NoteCapture — the box you type a note into.
//
// Lives here rather than on the notes page because it belongs in more than one
// place: the whole argument for this feature is that capture beats the app it
// replaces, and a box you have to navigate to has already lost. It sits on the
// HQ home page AND on /notes, from one definition, so the two can't drift into
// behaving differently.
//
// Everything past the text is optional and collapsed. Urgency, a date and
// handing it to an agent are real, but asking for them up front is how a
// five-second capture becomes a form nobody fills in.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";

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

export default function NoteCapture({
  onAdded,
  autoFocus = false,
}: {
  onAdded?: () => void;
  /** Only the notes page grabs focus — stealing it on the home page would
   *  hijack the keyboard from everything else there. */
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [owner, setOwner] = useState<"chris" | "jeremy">("chris");
  const [urgency, setUrgency] = useState<"low" | "normal" | "high">("normal");
  const [dueOn, setDueOn] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showExtras, setShowExtras] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const remembered = localStorage.getItem(OWNER_KEY);
      if (remembered === "chris" || remembered === "jeremy") setOwner(remembered);
    } catch {
      /* ignore */
    }
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Only needed for the optional hand-off, so a failure here must never stop a
  // note being written.
  const loadEmployees = useCallback(() => {
    if (employees.length > 0) return;
    fetch("/api/org/directory")
      .then((r) => r.json())
      .then((j) => setEmployees((j.employees ?? []).filter((e: Employee) => e.staffed)))
      .catch(() => {});
  }, [employees.length]);

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
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      onAdded?.();
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-4">
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
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-[#0094b8]/50 focus:outline-none"
        />
        <button
          onClick={() => void add()}
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-lg border border-[#0094b8]/40 bg-[#0094b8]/10 px-4 py-2 text-xs font-medium text-[#00d6ff] hover:bg-[#0094b8]/20 disabled:opacity-40"
        >
          {busy ? "Saving…" : saved ? "Saved" : "Add"}
        </button>
      </div>

      <button
        onClick={() => {
          setShowExtras((v) => !v);
          loadEmployees();
        }}
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
  );
}
