import { describe, it, expect } from "vitest";
import { priorMonthToDate } from "./route";

// The dashboard compared month-to-date against a FULL previous month, so a flat
// business read as a collapse and read worse the earlier in the month you
// looked. These pin the like-for-like window.

describe("priorMonthToDate", () => {
  it("takes the same number of days into the previous month", () => {
    // 14 August → compare against 1–14 July, not all of July.
    expect(priorMonthToDate(2026, 6, 14)).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-14",
    });
  });

  it("always starts on the first", () => {
    expect(priorMonthToDate(2026, 6, 1).startDate).toBe("2026-07-01");
    expect(priorMonthToDate(2026, 6, 1).endDate).toBe("2026-07-01");
  });

  it("clamps to a shorter previous month instead of spilling forward", () => {
    // 31 March against February — February has 28 days in 2026.
    expect(priorMonthToDate(2026, 1, 31)).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
  });

  it("handles a leap February", () => {
    expect(priorMonthToDate(2028, 1, 31).endDate).toBe("2028-02-29");
  });

  it("covers the whole previous month when the current one is finished", () => {
    // 31 August → all of July, so a completed month compares against a
    // completed month with no special casing.
    expect(priorMonthToDate(2026, 6, 31)).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
  });

  it("crosses a year boundary", () => {
    // January comparing back to December.
    expect(priorMonthToDate(2025, 11, 10)).toEqual({
      startDate: "2025-12-01",
      endDate: "2025-12-10",
    });
  });

  it("never ends before it starts", () => {
    for (let month = 0; month < 12; month++) {
      for (const day of [1, 15, 28, 29, 30, 31]) {
        const r = priorMonthToDate(2026, month, day);
        expect(r.endDate >= r.startDate).toBe(true);
      }
    }
  });

  it("stays inside the month it was asked about", () => {
    for (let month = 0; month < 12; month++) {
      const r = priorMonthToDate(2026, month, 31);
      const expectedPrefix = `2026-${String(month + 1).padStart(2, "0")}`;
      expect(r.startDate.startsWith(expectedPrefix)).toBe(true);
      expect(r.endDate.startsWith(expectedPrefix)).toBe(true);
    }
  });
});
