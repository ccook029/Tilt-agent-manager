import { describe, it, expect } from "vitest";
import { countSticksSold, parseSoldDate, dayFromIso } from "./sticks-sold";
import type { StickRecord } from "./zoho-sheet";

// This is the number on the front page of HQ. It read 0 for months while
// revenue beside it looked fine, which is the failure worth guarding: a metric
// that's wrong in a plausible direction doesn't get reported as broken.

const stick = (over: Partial<StickRecord> = {}): StickRecord => ({
  row_index: 1, tab: "Player", level: "Senior", size: 66, carbon: "24K",
  kick_point: "Mid", hand: "Left", flex: 80, curve: "T28M",
  base_color: "Black", decal_color: "Halo",
  serial_number: "H2607-00001", status: "Available", date_sold: "", location: "",
  ...over,
});

const sold = (date: string, over: Partial<StickRecord> = {}) =>
  stick({ status: "Sold", date_sold: date, ...over });

describe("countSticksSold", () => {
  it("counts sticks sold inside the range", () => {
    const r = countSticksSold(
      [sold("2026-08-03"), sold("2026-08-14"), sold("2026-08-20")],
      "2026-08-01",
      "2026-08-14"
    );
    expect(r.count).toBe(2);
  });

  it("includes both ends of the range", () => {
    const r = countSticksSold(
      [sold("2026-08-01"), sold("2026-08-14")],
      "2026-08-01",
      "2026-08-14"
    );
    expect(r.count).toBe(2);
  });

  it("ignores sticks that haven't sold", () => {
    const r = countSticksSold(
      [stick({ status: "Available" }), stick({ status: "In Production" }), sold("2026-08-05")],
      "2026-08-01",
      "2026-08-31"
    );
    expect(r.count).toBe(1);
  });

  it("reads Sold however it was typed", () => {
    const r = countSticksSold(
      [sold("2026-08-05", { status: "sold" }), sold("2026-08-06", { status: " SOLD " })],
      "2026-08-01",
      "2026-08-31"
    );
    expect(r.count).toBe(2);
  });

  it("counts one per row, because one row is one stick", () => {
    // The old invoice-based count summed SKU quantities; this counts sticks,
    // which is what the tile says.
    const r = countSticksSold(
      [sold("2026-08-05"), sold("2026-08-05"), sold("2026-08-05")],
      "2026-08-01",
      "2026-08-31"
    );
    expect(r.count).toBe(3);
  });

  it("reports sold sticks whose date can't be read instead of hiding them", () => {
    const r = countSticksSold(
      [sold("2026-08-05"), sold("sometime in August"), sold("")],
      "2026-08-01",
      "2026-08-31"
    );
    expect(r.count).toBe(1);
    expect(r.unreadableDates).toBe(2);
  });

  it("returns zero rather than throwing on a bad range", () => {
    const r = countSticksSold([sold("2026-08-05")], "not-a-date", "2026-08-31");
    expect(r.count).toBe(0);
  });

  it("separates two adjacent months cleanly", () => {
    const records = [sold("2026-07-31"), sold("2026-08-01")];
    expect(countSticksSold(records, "2026-07-01", "2026-07-31").count).toBe(1);
    expect(countSticksSold(records, "2026-08-01", "2026-08-31").count).toBe(1);
  });
});

describe("parseSoldDate", () => {
  it("reads what the storefront writes", () => {
    expect(parseSoldDate("2026-08-14")).toBe(20260814);
  });

  it("reads the hand-typed variants", () => {
    expect(parseSoldDate("2026/08/14")).toBe(20260814);
    expect(parseSoldDate("2026-8-4")).toBe(20260804);
    expect(parseSoldDate("  2026-08-14  ")).toBe(20260814);
  });

  it("resolves day/month order when one part can't be a month", () => {
    expect(parseSoldDate("14/08/2026")).toBe(20260814); // D/M/Y
    expect(parseSoldDate("08/14/2026")).toBe(20260814); // M/D/Y
  });

  it("refuses a genuinely ambiguous date rather than guessing", () => {
    // 05/08/2026 is either 5 August or 8 May. Guessing would put a stick in the
    // wrong month and nobody would ever know.
    expect(parseSoldDate("05/08/2026")).toBeNull();
  });

  it("refuses nonsense", () => {
    expect(parseSoldDate("")).toBeNull();
    expect(parseSoldDate("soon")).toBeNull();
    expect(parseSoldDate("2026-13-01")).toBeNull();
    expect(parseSoldDate("2026-08-32")).toBeNull();
  });
});

describe("dayFromIso", () => {
  it("converts a range bound", () => {
    expect(dayFromIso("2026-08-01")).toBe(20260801);
  });
  it("rejects anything that isn't ISO", () => {
    expect(dayFromIso("08/01/2026")).toBeNull();
  });
});
