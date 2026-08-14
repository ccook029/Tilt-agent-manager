// ---------------------------------------------------------------------------
// /api/notes — the founders' things-to-remember list.
//
//   GET                → every note, in reading order, plus what's due
//   POST { text, … }   → add one
//   PATCH { id, … }    → edit, tick off, or attach a work order
//   DELETE ?id=        → remove one
//
// POST also accepts { assignTo } to hand the note to an agent as REAL work: it
// creates the work order and links it back. That's the promote step — kept as
// an explicit action rather than something every note does, so the work board
// stays a list of actual work.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  listNotes,
  addNote,
  updateNote,
  deleteNote,
  sortNotes,
  noteReminders,
  isNoteOwner,
  ownerName,
  type Urgency,
} from "@/lib/notes";
import { createWorkOrder } from "@/lib/org/work-orders";
import { getEmployeeById } from "@/lib/org/directory";

export const dynamic = "force-dynamic";

const URGENCIES = new Set(["low", "normal", "high"]);

export async function GET() {
  const notes = await listNotes();
  const reminders = noteReminders(notes);
  return NextResponse.json({
    ok: true,
    notes: sortNotes(notes),
    counts: {
      open: notes.filter((n) => !n.done).length,
      overdue: reminders.overdue.length,
      today: reminders.today.length,
      soon: reminders.soon.length,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    owner?: string;
    urgency?: string;
    dueOn?: string;
    assignTo?: string;
  };

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: "A note needs some text." }, { status: 400 });
  }
  const owner = (body.owner ?? "").trim();
  if (!isNoteOwner(owner)) {
    return NextResponse.json({ ok: false, error: "Say whose note this is." }, { status: 400 });
  }
  const urgency = URGENCIES.has(body.urgency ?? "")
    ? (body.urgency as Urgency)
    : "normal";

  try {
    const note = await addNote({ text, owner, urgency, dueOn: body.dueOn });

    // Optional: hand it straight to an agent as real work.
    if (body.assignTo) {
      const employee = getEmployeeById(body.assignTo);
      if (!employee) {
        return NextResponse.json(
          { ok: true, note, warning: `No employee "${body.assignTo}" — the note was saved but not assigned.` }
        );
      }
      const order = await createWorkOrder({
        departmentId: employee.departmentId,
        assigneeId: employee.id,
        title: text.slice(0, 80),
        brief: `${text}\n\n(Raised by ${ownerName(owner)} from their notes${
          note.dueOn ? `, needed by ${note.dueOn}` : ""
        }.)`,
        createdBy: `${ownerName(owner)} (note)`,
      });
      const linked = await updateNote(note.id, {
        workOrderId: order.id,
        assignedTo: employee.id,
        assignedToName: employee.name,
      });
      return NextResponse.json({ ok: true, note: linked ?? note, workOrderId: order.id });
    }

    return NextResponse.json({ ok: true, note });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    text?: string;
    owner?: string;
    urgency?: string;
    dueOn?: string;
    done?: boolean;
  };
  if (!body.id) {
    return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
  }
  if (body.owner !== undefined && !isNoteOwner(body.owner)) {
    return NextResponse.json({ ok: false, error: "Unknown owner." }, { status: 400 });
  }
  if (body.urgency !== undefined && !URGENCIES.has(body.urgency)) {
    return NextResponse.json({ ok: false, error: "Unknown urgency." }, { status: 400 });
  }

  try {
    const note = await updateNote(body.id, {
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.owner !== undefined ? { owner: body.owner as never } : {}),
      ...(body.urgency !== undefined ? { urgency: body.urgency as Urgency } : {}),
      ...(body.dueOn !== undefined ? { dueOn: body.dueOn } : {}),
      ...(body.done !== undefined ? { done: body.done } : {}),
    });
    if (!note) {
      return NextResponse.json({ ok: false, error: "Note not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, note });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
  }
  const removed = await deleteNote(id);
  if (!removed) {
    return NextResponse.json({ ok: false, error: "Note not found." }, { status: 404 });
  }
  // Deliberately quiet — a deleted note is a private act, not company news,
  // so nothing goes to the signals feed.
  return NextResponse.json({ ok: true });
}
