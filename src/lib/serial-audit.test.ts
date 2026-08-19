import { describe, it, expect } from "vitest";
import {
  serialKey,
  parseSerial,
  auditSerials,
  batchSummary,
  parseCountInput,
  serialsFromGrid,
} from "./serial-audit";
import type { StickRecord } from "./zoho-sheet";

// This decides what gets reported as missing stock. A false positive sends
// somebody hunting for a stick that's fine; a false negative leaves a stick
// listed for sale that nobody can ship. Both are quiet, so they're pinned here.

const rec = (over: Partial<StickRecord> = {}): StickRecord => ({
  row_index: 1, tab: "Player", level: "Senior", size: 66, carbon: "24K",
  kick_point: "Mid", hand: "Left", flex: 80, curve: "T28M",
  base_color: "Black", decal_color: "Halo",
  serial_number: "H2607-09684", status: "Available", date_sold: "",
  ...over,
});

describe("serialKey", () => {
  it("matches the same serial written either way round", () => {
    // The factory's April 2026 run printed YYYYMM instead of YYMM. Same stick.
    expect(serialKey("H202604-05359")).toBe(serialKey("H2604-05359"));
  });

  it("survives whatever separator the printer used", () => {
    const want = serialKey("H2312-01020");
    expect(serialKey("H2312.01020")).toBe(want);
    expect(serialKey("h2312 01020")).toBe(want);
    expect(serialKey("H231201020")).toBe(want);
  });

  it("keeps genuinely different sticks apart", () => {
    expect(serialKey("H2607-09684")).not.toBe(serialKey("H2607-09685"));
    expect(serialKey("H2607-09684")).not.toBe(serialKey("H2606-09684"));
  });

  it("does not collapse a prefix whose month isn't real", () => {
    // H201699 isn't December-anything; folding it would invent a collision.
    expect(serialKey("H201699-05359")).not.toBe(serialKey("H1699-05359"));
  });

  it("is empty for nothing", () => {
    expect(serialKey("")).toBe("");
    expect(serialKey("   ")).toBe("");
  });
});

describe("parseSerial", () => {
  it("reads the standard label", () => {
    expect(parseSerial("H2607-09684")).toEqual({
      prefix: "H2607", sequence: "09684", batchMonth: "2026-07", format: "standard",
    });
  });

  it("reads the wide-date label and reports it as the outlier it is", () => {
    expect(parseSerial("H202604-05359")).toEqual({
      prefix: "H202604", sequence: "05359", batchMonth: "2026-04", format: "wide-date",
    });
  });

  it("keeps leading zeros on the sequence", () => {
    // 00284 and 284 are different labels; dropping the zeros loses the sort.
    expect(parseSerial("H2510-00284").sequence).toBe("00284");
  });

  it("doesn't invent a date out of a month that can't exist", () => {
    expect(parseSerial("H2613-00284").batchMonth).toBe("");
    expect(parseSerial("H2613-00284").format).toBe("unknown");
  });

  it("gives back something usable for a serial it can't read", () => {
    const p = parseSerial("WHO-KNOWS");
    expect(p.format).toBe("unknown");
    expect(p.batchMonth).toBe("");
  });
});

describe("auditSerials", () => {
  it("returns the sheet's specs for a counted stick", () => {
    const a = auditSerials(
      [{ serial: "H2607-09684" }],
      [rec({ serial_number: "H2607-09684", curve: "T92M", flex: 75 })]
    );
    expect(a.matched).toHaveLength(1);
    expect(a.matched[0].record.curve).toBe("T92M");
    expect(a.matched[0].record.flex).toBe(75);
  });

  it("matches across the two date formats in both directions", () => {
    const a = auditSerials(
      [{ serial: "H202604-05359" }],
      [rec({ serial_number: "H2604-05359" })]
    );
    expect(a.summary.matched).toBe(1);
    expect(a.summary.notOnSheet).toBe(0);

    const b = auditSerials(
      [{ serial: "H2604-05359" }],
      [rec({ serial_number: "H202604-05359" })]
    );
    expect(b.summary.matched).toBe(1);
    expect(b.summary.notOnSheet).toBe(0);
  });

  it("flags a counted stick the sheet has never heard of", () => {
    const a = auditSerials(
      [{ serial: "H2607-09684" }, { serial: "H2607-99999" }],
      [rec({ serial_number: "H2607-09684" })]
    );
    expect(a.notOnSheet.map((n) => n.serial)).toEqual(["H2607-99999"]);
  });

  it("flags a stick the sheet says is here that nobody counted", () => {
    const a = auditSerials(
      [{ serial: "H2607-09684" }],
      [
        rec({ serial_number: "H2607-09684" }),
        rec({ serial_number: "H2607-09685", status: "Available" }),
      ]
    );
    expect(a.missingFromCount).toHaveLength(1);
    expect(a.missingFromCount[0].record.serial_number).toBe("H2607-09685");
  });

  it("does not chase a stick that already sold", () => {
    // Sold and not on the rack is the system working, not a discrepancy.
    const a = auditSerials(
      [],
      [rec({ serial_number: "H2607-09685", status: "Sold", date_sold: "2026-08-01" })]
    );
    expect(a.missingFromCount).toHaveLength(0);
  });

  it("flags a sold stick that's still sitting there", () => {
    const a = auditSerials(
      [{ serial: "H2607-09684" }],
      [rec({ serial_number: "H2607-09684", status: "Sold", date_sold: "2026-08-01" })]
    );
    expect(a.soldButPresent).toHaveLength(1);
    // It's still a match — the specs are known, it's the status that's odd.
    expect(a.matched).toHaveLength(1);
  });

  it("leaves sticks that aren't built yet out of it entirely", () => {
    // Pre-order rows carry a PROD- placeholder and sit at the factory. A floor
    // count can't contradict them, and reporting them as missing would bury
    // the real discrepancies under every open pre-order.
    const a = auditSerials(
      [],
      [
        rec({ serial_number: "PROD-0042", status: "In Production" }),
        rec({ serial_number: "", status: "In Production" }),
        rec({ serial_number: "H2609-00001", status: "In Production" }),
      ]
    );
    expect(a.missingFromCount).toHaveLength(0);
    expect(a.summary.skippedNotYetBuilt).toBe(3);
  });

  it("never matches a counted stick to a placeholder row", () => {
    const a = auditSerials(
      [{ serial: "PROD-0042" }],
      [rec({ serial_number: "PROD-0042", status: "In Production" })]
    );
    expect(a.matched).toHaveLength(0);
    expect(a.notOnSheet).toHaveLength(1);
  });

  it("reports a serial counted twice instead of double-counting it", () => {
    const a = auditSerials(
      [{ serial: "H2607-09684" }, { serial: "H2607.09684" }],
      [rec({ serial_number: "H2607-09684" })]
    );
    expect(a.duplicatesInCount).toEqual(["H2607.09684"]);
    expect(a.summary.counted).toBe(1);
    expect(a.matched).toHaveLength(1);
  });

  it("keeps the counter's note attached to the stick", () => {
    const a = auditSerials(
      [{ serial: "H2607-09684", note: "photo blur — re-verify" }],
      [rec({ serial_number: "H2607-09684" })]
    );
    expect(a.matched[0].note).toBe("photo blur — re-verify");
  });

  it("reports the label as counted, not as normalised", () => {
    // What's printed on the stick is what somebody has to go and find.
    const a = auditSerials([{ serial: "h2607.09684" }], []);
    expect(a.notOnSheet[0].serial).toBe("h2607.09684");
  });

  it("adds up", () => {
    const a = auditSerials(
      [{ serial: "H2607-09684" }, { serial: "H2607-09685" }, { serial: "H2607-99999" }],
      [
        rec({ serial_number: "H2607-09684" }),
        rec({ serial_number: "H2607-09685", status: "Sold", date_sold: "2026-08-01" }),
        rec({ serial_number: "H2607-09686", status: "Available" }),
      ]
    );
    expect(a.summary).toEqual({
      counted: 3,
      matched: 2,
      notOnSheet: 1,
      soldButPresent: 1,
      missingFromCount: 1,
      skippedNotYetBuilt: 0,
    });
  });
});

describe("batchSummary", () => {
  it("groups a count by batch with its sequence range", () => {
    const counted = [
      { serial: "H2510-00284" }, { serial: "H2510-00312" }, { serial: "H2607-09684" },
    ];
    const lines = batchSummary(counted, auditSerials(counted, []));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      prefix: "H2510", batchMonth: "2025-10", count: 2, sequenceRange: "00284 – 00312",
    });
    expect(lines[1]).toMatchObject({ prefix: "H2607", count: 1, sequenceRange: "09684" });
  });

  it("orders batches oldest first", () => {
    const counted = [{ serial: "H2607-09684" }, { serial: "H2312-01020" }];
    const lines = batchSummary(counted, auditSerials(counted, []));
    expect(lines.map((l) => l.prefix)).toEqual(["H2312", "H2607"]);
  });

  it("counts how many of each batch the sheet actually knows", () => {
    const counted = [{ serial: "H2607-09684" }, { serial: "H2607-09685" }];
    const audit = auditSerials(counted, [rec({ serial_number: "H2607-09684" })]);
    expect(batchSummary(counted, audit)[0]).toMatchObject({ count: 2, matched: 1 });
  });
});

describe("serialsFromGrid", () => {
  it("finds the serial column by its header, wherever it sits", () => {
    const grid = [
      ["#", "Full Serial", "Prefix", "Flag"],
      [1, "H2312-01020", "H2312", "photo blur"],
      [2, "H2404-03740", "H2404", ""],
    ];
    expect(serialsFromGrid(grid)).toEqual([
      { serial: "H2312-01020", note: "photo blur" },
      { serial: "H2404-03740" },
    ]);
  });

  it("prefers Full Serial when a sheet has both", () => {
    const grid = [
      ["Serial (short)", "Full Serial"],
      ["01020", "H2312-01020"],
    ];
    expect(serialsFromGrid(grid)).toEqual([{ serial: "H2312-01020" }]);
  });

  it("skips a totals row rather than auditing the word TOTAL", () => {
    const grid = [
      ["Full Serial"],
      ["H2607-09684"],
      ["TOTAL 65"],
    ];
    expect(serialsFromGrid(grid)).toEqual([{ serial: "H2607-09684" }]);
  });

  it("still reads a sheet with no header at all", () => {
    expect(serialsFromGrid([["H2607-09684"], ["H2607-09685"]])).toEqual([
      { serial: "H2607-09684" },
      { serial: "H2607-09685" },
    ]);
  });

  it("copes with a header that isn't on the first row", () => {
    const grid = [
      ["Tilt Stick Register"],
      [],
      ["Full Serial", "Flag"],
      ["H2607-09684", "aged"],
    ];
    expect(serialsFromGrid(grid)).toEqual([{ serial: "H2607-09684", note: "aged" }]);
  });
});

describe("parseCountInput", () => {
  it("reads one serial per line", () => {
    expect(parseCountInput("H2607-09684\nH2607-09685")).toEqual([
      { serial: "H2607-09684" }, { serial: "H2607-09685" },
    ]);
  });

  it("keeps a trailing note", () => {
    expect(parseCountInput("H2607-09684, photo blur")).toEqual([
      { serial: "H2607-09684", note: "photo blur" },
    ]);
  });

  it("ignores blank lines and a pasted header", () => {
    expect(parseCountInput("Serial\n\nH2607-09684\n\n")).toEqual([
      { serial: "H2607-09684" },
    ]);
  });

  it("takes a pasted spreadsheet column with tabs", () => {
    expect(parseCountInput("H2607-09684\tAged stock")).toEqual([
      { serial: "H2607-09684", note: "Aged stock" },
    ]);
  });
});
