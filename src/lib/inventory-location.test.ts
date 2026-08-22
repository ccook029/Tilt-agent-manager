import { describe, it, expect } from "vitest";
import {
  normalizeLocation,
  isAtRetailer,
  planLocationChange,
  describePlan,
  TILT_HQ,
} from "./inventory-location";
import { normalizeSerial } from "./inventory-intake";
import type { StickRecord } from "./zoho-sheet";

// This plan is what Chris reads before pressing a button that edits the master
// sheet. Everything it declines to write has to be named — a serial that
// silently does nothing is how 77 consigned sticks end up half-moved.

const matchKey = (s: string) => normalizeSerial(s);

const rec = (over: Partial<StickRecord> & { location?: string } = {}): StickRecord =>
  ({
    row_index: 2, tab: "Player", level: "Senior", size: 66, carbon: "24K",
    kick_point: "Mid", hand: "Left", flex: 80, curve: "T28M",
    base_color: "Black", decal_color: "Halo",
    serial_number: "H2607-09684", status: "Available", date_sold: "", location: "",
    ...over,
  }) as StickRecord;

const plan = (records: StickRecord[], serials: string[], loc = "Faust Home Hardware") =>
  planLocationChange(records, serials, loc, matchKey);

describe("normalizeLocation", () => {
  it("treats blank as Tilt HQ", () => {
    // 745 existing rows are blank. Writing "Tilt HQ" into all of them would be
    // 745 API calls to say what silence already says.
    expect(normalizeLocation("")).toBe(TILT_HQ);
    expect(normalizeLocation(null)).toBe(TILT_HQ);
    expect(normalizeLocation("   ")).toBe(TILT_HQ);
  });

  it("folds a known location typed in any case", () => {
    // Otherwise "faust home hardware" and "Faust Home Hardware" are two places
    // on every report that groups by location.
    expect(normalizeLocation("faust home hardware")).toBe("Faust Home Hardware");
    expect(normalizeLocation("  SPORTS EXCELLENCE ")).toBe("Sports Excellence");
  });

  it("accepts a location nobody has registered yet", () => {
    // A new retailer shouldn't need a deploy.
    expect(normalizeLocation("Play It Again Sports")).toBe("Play It Again Sports");
  });
});

describe("isAtRetailer", () => {
  it("is false at Tilt and for a blank", () => {
    expect(isAtRetailer("")).toBe(false);
    expect(isAtRetailer(TILT_HQ)).toBe(false);
  });
  it("is true anywhere else", () => {
    expect(isAtRetailer("Faust Home Hardware")).toBe(true);
  });
});

describe("planLocationChange", () => {
  it("plans a move for a stick sitting at Tilt", () => {
    const p = plan([rec()], ["H2607-09684"]);
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0]).toMatchObject({
      serial: "H2607-09684",
      from: TILT_HQ,
      to: "Faust Home Hardware",
      rowIndex: 2,
    });
  });

  it("leaves a consigned stick Available, because the retailer sells it", () => {
    // The whole point: consignment changes where it is, not whether it's for
    // sale. A plan that touched status would take it off the shelf.
    const p = plan([rec()], ["H2607-09684"]);
    expect(p.changes[0].status).toBe("Available");
  });

  it("writes nothing for a stick already at that location", () => {
    const p = plan([rec({ location: "Faust Home Hardware" } as never)], ["H2607-09684"]);
    expect(p.changes).toHaveLength(0);
    expect(p.unchanged).toHaveLength(1);
  });

  it("matches a location that was typed in a different case", () => {
    const p = plan([rec({ location: "faust home hardware" } as never)], ["H2607-09684"]);
    expect(p.unchanged).toHaveLength(1);
  });

  it("names a serial the sheet has never heard of", () => {
    const p = plan([rec()], ["H2607-09684", "H2607-99999"]);
    expect(p.notFound).toEqual(["H2607-99999"]);
    expect(p.changes).toHaveLength(1);
  });

  it("holds back a sold stick instead of moving it with the rest", () => {
    // Moving a sold stick's location is nearly always a mistyped serial, and
    // it would be written silently among 77 correct ones.
    const p = plan(
      [rec({ status: "Sold", date_sold: "2026-08-01" })],
      ["H2607-09684"]
    );
    expect(p.changes).toHaveLength(0);
    expect(p.alreadySold).toHaveLength(1);
  });

  it("skips anything still at the factory", () => {
    const p = plan(
      [
        rec({ serial_number: "PROD-0042", status: "In Production" }),
        rec({ serial_number: "H2609-00001", status: "In Production", row_index: 3 }),
      ],
      ["PROD-0042", "H2609-00001"]
    );
    expect(p.changes).toHaveLength(0);
    expect(p.notYetBuilt).toHaveLength(2);
  });

  it("reports a serial listed twice rather than writing it twice", () => {
    const p = plan([rec()], ["H2607-09684", "H2607 09684"]);
    expect(p.duplicates).toHaveLength(1);
    expect(p.changes).toHaveLength(1);
  });

  it("carries the tab and row, because that's what the write needs", () => {
    const p = plan([rec({ tab: "Goalie", row_index: 17 })], ["H2607-09684"]);
    expect(p.changes[0]).toMatchObject({ tab: "Goalie", rowIndex: 17 });
  });

  it("can send stock back to Tilt", () => {
    const p = planLocationChange(
      [rec({ location: "Faust Home Hardware" } as never)],
      ["H2607-09684"],
      TILT_HQ,
      matchKey
    );
    expect(p.changes[0]).toMatchObject({ from: "Faust Home Hardware", to: TILT_HQ });
  });

  it("ignores blank input lines", () => {
    const p = plan([rec()], ["", "   ", "H2607-09684"]);
    expect(p.changes).toHaveLength(1);
    expect(p.notFound).toHaveLength(0);
  });
});

describe("describePlan", () => {
  it("leads with what will be written", () => {
    const p = plan([rec()], ["H2607-09684", "H2607-99999"]);
    expect(describePlan(p)).toBe("1 to move · 1 not on the sheet");
  });

  it("says only what applies", () => {
    expect(describePlan(plan([rec()], ["H2607-09684"]))).toBe("1 to move");
  });
});
