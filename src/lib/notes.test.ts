import { describe, it, expect } from "vitest";
import {
  dueState,
  sortNotes,
  noteReminders,
  renderNoteReminders,
  parseDay,
  ownerName,
  isNoteOwner,
  type Note,
} from "./notes";

// The point of writing something down with a date is that it comes back on that
// date. Everything here is about that promise holding.

const note = (over: Partial<Note> = {}): Note => ({
  id: "n1",
  text: "Chase the Lucan invoice",
  owner: "chris",
  urgency: "normal",
  done: false,
  createdAt: "2026-08-01T10:00:00.000Z",
  ...over,
});

const on = (iso: string) => new Date(`${iso}T12:00:00`);

describe("dueState", () => {
  const today = on("2026-08-14");

  it("is none without a date — most notes are just thoughts", () => {
    expect(dueState(note(), today)).toBe("none");
  });

  it("separates overdue, today, this week, and later", () => {
    expect(dueState(note({ dueOn: "2026-08-13" }), today)).toBe("overdue");
    expect(dueState(note({ dueOn: "2026-08-14" }), today)).toBe("today");
    expect(dueState(note({ dueOn: "2026-08-18" }), today)).toBe("soon");
    expect(dueState(note({ dueOn: "2026-08-21" }), today)).toBe("soon");
    expect(dueState(note({ dueOn: "2026-08-22" }), today)).toBe("later");
  });

  it("counts seven days inclusively, so the boundary can't swallow a day", () => {
    expect(dueState(note({ dueOn: "2026-08-21" }), today)).toBe("soon");
  });

  it("handles a window that crosses a month end", () => {
    expect(dueState(note({ dueOn: "2026-09-02" }), on("2026-08-30"))).toBe("soon");
    expect(dueState(note({ dueOn: "2026-09-08" }), on("2026-08-30"))).toBe("later");
  });

  it("treats a malformed date as no date rather than throwing", () => {
    // A typo'd note that loses its date is recoverable. A page that won't
    // render is not.
    expect(dueState(note({ dueOn: "14-08-2026" }), today)).toBe("none");
    expect(dueState(note({ dueOn: "soon" }), today)).toBe("none");
  });

  it("reads the date locally, so it doesn't go overdue a day early", () => {
    expect(dueState(note({ dueOn: "2026-08-14" }), new Date("2026-08-14T23:30:00"))).toBe("today");
  });
});

describe("sortNotes", () => {
  const today = on("2026-08-14");

  it("puts what's late first, then what's next", () => {
    const out = sortNotes(
      [
        note({ id: "later", dueOn: "2026-09-30" }),
        note({ id: "none" }),
        note({ id: "overdue", dueOn: "2026-08-01" }),
        note({ id: "today", dueOn: "2026-08-14" }),
      ],
      today
    );
    expect(out.map((n) => n.id)).toEqual(["overdue", "today", "later", "none"]);
  });

  it("ranks a late low-urgency note above an urgent one with no date", () => {
    // The late one has already failed; the urgent undated one is a wish.
    const out = sortNotes(
      [
        note({ id: "wish", urgency: "high" }),
        note({ id: "failed", urgency: "low", dueOn: "2026-08-01" }),
      ],
      today
    );
    expect(out[0].id).toBe("failed");
  });

  it("falls back to urgency, then newest", () => {
    const out = sortNotes(
      [
        note({ id: "old-high", urgency: "high", createdAt: "2026-08-01T00:00:00.000Z" }),
        note({ id: "new-low", urgency: "low", createdAt: "2026-08-13T00:00:00.000Z" }),
        note({ id: "new-high", urgency: "high", createdAt: "2026-08-13T00:00:00.000Z" }),
      ],
      today
    );
    expect(out.map((n) => n.id)).toEqual(["new-high", "old-high", "new-low"]);
  });

  it("sinks done notes regardless of how late they were", () => {
    const out = sortNotes(
      [note({ id: "done", done: true, dueOn: "2026-01-01" }), note({ id: "open" })],
      today
    );
    expect(out[0].id).toBe("open");
  });

  it("doesn't mutate what it was given", () => {
    const input = [note({ id: "a" }), note({ id: "b", dueOn: "2026-08-01" })];
    const before = input.map((n) => n.id);
    sortNotes(input, today);
    expect(input.map((n) => n.id)).toEqual(before);
  });
});

describe("noteReminders — what reaches the brief", () => {
  const today = on("2026-08-14");

  it("carries overdue, today and the next seven days", () => {
    const r = noteReminders(
      [
        note({ id: "a", dueOn: "2026-08-10" }),
        note({ id: "b", dueOn: "2026-08-14" }),
        note({ id: "c", dueOn: "2026-08-19" }),
        note({ id: "d", dueOn: "2026-12-01" }),
      ],
      today
    );
    expect(r.overdue.map((n) => n.id)).toEqual(["a"]);
    expect(r.today.map((n) => n.id)).toEqual(["b"]);
    expect(r.soon.map((n) => n.id)).toEqual(["c"]);
  });

  it("leaves out undated notes", () => {
    // An undated note is a thought, not a deadline. Repeating it every morning
    // is how the brief stops being read.
    const r = noteReminders([note({ id: "thought" })], today);
    expect(r.overdue.concat(r.today, r.soon)).toHaveLength(0);
  });

  it("leaves out anything already ticked off", () => {
    const r = noteReminders([note({ dueOn: "2026-08-01", done: true })], today);
    expect(r.overdue).toHaveLength(0);
  });
});

describe("renderNoteReminders", () => {
  const today = on("2026-08-14");

  it("says nothing when nothing is due", () => {
    expect(renderNoteReminders([note()], today)).toBeNull();
  });

  it("names who each one belongs to", () => {
    const text = renderNoteReminders(
      [note({ owner: "jeremy", dueOn: "2026-08-01", text: "Call Adeem" })],
      today
    );
    expect(text).toContain("Jeremy");
    expect(text).toContain("Call Adeem");
    expect(text).toContain("Overdue");
  });

  it("marks the high-urgency ones", () => {
    const text = renderNoteReminders(
      [note({ urgency: "high", dueOn: "2026-08-14" })],
      today
    );
    expect(text).toContain("[high]");
  });
});

describe("owners and dates", () => {
  it("accepts only the two founders", () => {
    expect(isNoteOwner("chris")).toBe(true);
    expect(isNoteOwner("jeremy")).toBe(true);
    expect(isNoteOwner("stockton")).toBe(false);
    expect(isNoteOwner("")).toBe(false);
  });

  it("names them", () => {
    expect(ownerName("chris")).toBe("Chris");
    expect(ownerName("jeremy")).toBe("Jeremy");
  });

  it("rejects dates that aren't real", () => {
    expect(parseDay("2026-08-14")).toBe(20260814);
    expect(parseDay("2026-13-01")).toBeNull();
    expect(parseDay("2026-08-32")).toBeNull();
    expect(parseDay("14/08/2026")).toBeNull();
    expect(parseDay("")).toBeNull();
  });
});
