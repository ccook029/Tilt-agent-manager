// ---------------------------------------------------------------------------
// notes.ts — the things Chris and Jeremy need to remember.
//
// Deliberately NOT work orders. A work order has an assignee, a deliverable and
// a review round; "ask Jeremy about the Lucan invoice" is none of those. Making
// every note a work order floods the board that tells you where real work sits,
// and it's the fastest way to make both lists useless. So notes stay light, and
// PROMOTING one to a work order is an explicit act — that's the seam.
//
// Kept small on purpose. Text, whose it is, how urgent, optionally when it's
// due. No tags, no projects, no attachments, no sub-notes. Note systems die of
// their own schema, and the only thing that makes this one worth having is that
// capture stays faster than the app it replaces.
//
// The reminder loop rides the daily brief rather than a new channel: a list you
// have to remember to open is a list you stop opening.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "founder-notes";

/** The founders. Not employees — they own the org rather than sit in it, so
 *  they aren't in the directory and this is the one place they're enumerated. */
export const NOTE_OWNERS = [
  { id: "chris", name: "Chris" },
  { id: "jeremy", name: "Jeremy" },
] as const;

export type NoteOwner = (typeof NOTE_OWNERS)[number]["id"];

/** Three levels. A fourth would only ever be argued about. */
export type Urgency = "low" | "normal" | "high";

export const URGENCIES: { id: Urgency; label: string }[] = [
  { id: "high", label: "High" },
  { id: "normal", label: "Normal" },
  { id: "low", label: "Low" },
];

export interface Note {
  id: string;
  text: string;
  owner: NoteOwner;
  urgency: Urgency;
  /** YYYY-MM-DD. Optional — most notes are just things to remember. */
  dueOn?: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
  /** Set when this note was sent to an agent as real work, so the note can say
   *  so instead of sitting there looking untouched. */
  workOrderId?: string;
  assignedTo?: string;
  assignedToName?: string;
}

export function isNoteOwner(v: string): v is NoteOwner {
  return NOTE_OWNERS.some((o) => o.id === v);
}

export function ownerName(id: NoteOwner): string {
  return NOTE_OWNERS.find((o) => o.id === id)?.name ?? id;
}

/* ── Dates ─────────────────────────────────────────────────────────────── */

/** YYYYMMDD as an integer so comparisons are plain maths on the local calendar
 *  day. A due date that flips a day early west of UTC is the same bug already
 *  fixed twice here — on the pre-order badge and the announcement bar. */
export function dayNumber(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

export function parseDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y * 10000 + mo * 100 + d;
}

export type DueState = "overdue" | "today" | "soon" | "later" | "none";

/**
 * Where a note sits relative to today.
 *
 * "soon" is the next 7 days — the window that belongs in a daily brief. Beyond
 * that it's real but not yet worth interrupting anyone about, and a brief that
 * lists everything due this quarter gets skimmed like weather.
 *
 * A malformed date reads as "none" rather than throwing: a typo'd note that
 * quietly loses its date is recoverable, a page that won't render isn't.
 */
export function dueState(note: Note, now: Date = new Date()): DueState {
  if (!note.dueOn) return "none";
  const due = parseDay(note.dueOn);
  if (due === null) return "none";
  const today = dayNumber(now);
  if (due < today) return "overdue";
  if (due === today) return "today";
  return due <= addDays(today, 7) ? "soon" : "later";
}

/** Calendar-day arithmetic on the YYYYMMDD integer, via a real Date so month
 *  and year rollovers are correct. */
function addDays(day: number, n: number): number {
  const y = Math.floor(day / 10000);
  const m = Math.floor((day % 10000) / 100);
  const d = day % 100;
  const shifted = new Date(y, m - 1, d + n);
  return dayNumber(shifted);
}

const URGENCY_RANK: Record<Urgency, number> = { high: 0, normal: 1, low: 2 };
const DUE_RANK: Record<DueState, number> = {
  overdue: 0, today: 1, soon: 2, later: 3, none: 4,
};

/**
 * Reading order: what's late, then what's next, then what matters most.
 *
 * Due state outranks urgency deliberately — a low-urgency note that's overdue
 * has already failed, while a high-urgency one with no date is a wish. Ties
 * break on newest first, so a note added today isn't buried under old ones.
 */
export function sortNotes(notes: Note[], now: Date = new Date()): Note[] {
  return [...notes].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const dueDiff = DUE_RANK[dueState(a, now)] - DUE_RANK[dueState(b, now)];
    if (dueDiff !== 0) return dueDiff;
    const aDue = a.dueOn ? parseDay(a.dueOn) : null;
    const bDue = b.dueOn ? parseDay(b.dueOn) : null;
    if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;
    const urg = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (urg !== 0) return urg;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/* ── Storage ───────────────────────────────────────────────────────────── */

export async function listNotes(): Promise<Note[]> {
  try {
    return (await kv.get<Note[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

async function save(notes: Note[]): Promise<void> {
  await kv.set(KEY, notes);
}

export async function addNote(input: {
  text: string;
  owner: NoteOwner;
  urgency?: Urgency;
  dueOn?: string;
}): Promise<Note> {
  const text = input.text.trim();
  if (!text) throw new Error("A note needs some text.");
  if (input.dueOn && parseDay(input.dueOn) === null) {
    throw new Error("Due date must be YYYY-MM-DD.");
  }
  const note: Note = {
    id: `note-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    text,
    owner: input.owner,
    urgency: input.urgency ?? "normal",
    dueOn: input.dueOn?.trim() || undefined,
    done: false,
    createdAt: new Date().toISOString(),
  };
  await save([note, ...(await listNotes())]);
  return note;
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<Note, "text" | "owner" | "urgency" | "dueOn" | "done" | "workOrderId" | "assignedTo" | "assignedToName">>
): Promise<Note | null> {
  const notes = await listNotes();
  const note = notes.find((n) => n.id === id);
  if (!note) return null;
  if (patch.dueOn !== undefined && patch.dueOn !== "" && parseDay(patch.dueOn) === null) {
    throw new Error("Due date must be YYYY-MM-DD.");
  }
  if (patch.text !== undefined) note.text = patch.text.trim() || note.text;
  if (patch.owner !== undefined) note.owner = patch.owner;
  if (patch.urgency !== undefined) note.urgency = patch.urgency;
  if (patch.dueOn !== undefined) note.dueOn = patch.dueOn.trim() || undefined;
  if (patch.workOrderId !== undefined) note.workOrderId = patch.workOrderId;
  if (patch.assignedTo !== undefined) note.assignedTo = patch.assignedTo;
  if (patch.assignedToName !== undefined) note.assignedToName = patch.assignedToName;
  if (patch.done !== undefined && patch.done !== note.done) {
    note.done = patch.done;
    note.doneAt = patch.done ? new Date().toISOString() : undefined;
  }
  await save(notes);
  return note;
}

export async function deleteNote(id: string): Promise<boolean> {
  const notes = await listNotes();
  const next = notes.filter((n) => n.id !== id);
  if (next.length === notes.length) return false;
  await save(next);
  return true;
}

/* ── For the brief ─────────────────────────────────────────────────────── */

export interface NoteReminders {
  overdue: Note[];
  today: Note[];
  soon: Note[];
}

/**
 * What belongs in a daily brief: late, due today, and the next seven days.
 *
 * Done notes and undated ones are excluded — an undated note is a thought, not
 * a deadline, and putting it in a reminder every morning is how the reminder
 * stops being read.
 */
export function noteReminders(notes: Note[], now: Date = new Date()): NoteReminders {
  const open = sortNotes(notes.filter((n) => !n.done), now);
  return {
    overdue: open.filter((n) => dueState(n, now) === "overdue"),
    today: open.filter((n) => dueState(n, now) === "today"),
    soon: open.filter((n) => dueState(n, now) === "soon"),
  };
}

/** One line per founder for the brief, or null when nothing is due. */
export function renderNoteReminders(notes: Note[], now: Date = new Date()): string | null {
  const { overdue, today, soon } = noteReminders(notes, now);
  if (overdue.length === 0 && today.length === 0 && soon.length === 0) return null;

  const lines: string[] = [];
  const block = (label: string, list: Note[]) => {
    if (list.length === 0) return;
    lines.push(`${label}:`);
    for (const n of list) {
      const who = ownerName(n.owner);
      const urg = n.urgency === "high" ? " [high]" : "";
      lines.push(`  - ${who}: ${n.text}${urg}${n.dueOn ? ` (${n.dueOn})` : ""}`);
    }
  };
  block("Overdue", overdue);
  block("Due today", today);
  block("Next 7 days", soon);
  return lines.join("\n");
}
