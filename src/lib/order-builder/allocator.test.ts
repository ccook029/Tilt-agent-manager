import { describe, it, expect } from "vitest";
import {
  unitCost,
  unitMsrp,
  srSurcharge,
  goalieMsrp,
  goalieUnitCost,
  channelPrice,
  MSRP,
} from "./allocator";

// The economics behind a factory order. These numbers decide how many sticks
// Tilt buys and what margin the order carries, so a silent drift here is
// expensive in a way that doesn't announce itself.

describe("MSRP ladder", () => {
  it("prices each level and carbon as the storefront does", () => {
    expect(MSRP.Junior["18K"]).toBe(165);
    expect(MSRP.Junior["24K"]).toBe(185);
    expect(MSRP.Intermediate["18K"]).toBe(215);
    expect(MSRP.Intermediate["24K"]).toBe(235);
    expect(MSRP.Senior["18K"]).toBe(265);
    expect(MSRP.Senior["24K"]).toBe(285);
  });

  it("charges more for 24K at every level", () => {
    for (const level of ["Junior", "Intermediate", "Senior"] as const) {
      expect(MSRP[level]["24K"]).toBeGreaterThan(MSRP[level]["18K"]);
    }
  });
});

describe("srSurcharge — long senior shafts cost more to make", () => {
  it("is free below 68 inches", () => {
    expect(srSurcharge(60)).toBe(0);
    expect(srSurcharge(67)).toBe(0);
  });

  it("steps at 68 and again at 72", () => {
    expect(srSurcharge(68)).toBe(10);
    expect(srSurcharge(71)).toBe(10);
    expect(srSurcharge(72)).toBe(20);
    expect(srSurcharge(75)).toBe(20);
  });

  it("never decreases as the stick gets longer", () => {
    let prev = 0;
    for (let size = 55; size <= 80; size++) {
      const s = srSurcharge(size);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe("unitMsrp", () => {
  it("applies the surcharge to seniors only", () => {
    expect(unitMsrp({ level: "Senior", carbon: "24K", size: 72 } as never)).toBe(285 + 20);
    // A junior stick can't be 72", but the rule must not fire on level alone.
    expect(unitMsrp({ level: "Junior", carbon: "24K", size: 72 } as never)).toBe(185);
    expect(unitMsrp({ level: "Intermediate", carbon: "18K", size: 72 } as never)).toBe(215);
  });

  it("matches the catalog price for a standard senior", () => {
    // $265 is the price the checkout tests pin for Tilt X1 - Senior.
    expect(unitMsrp({ level: "Senior", carbon: "18K", size: 66 } as never)).toBe(265);
  });
});

describe("unitCost — every stick carries the landed adder", () => {
  it("costs more in 24K than 18K at the same size", () => {
    const k18 = unitCost({ level: "Senior", carbon: "18K", size: 66 } as never);
    const k24 = unitCost({ level: "Senior", carbon: "24K", size: 66 } as never);
    expect(k24).toBeGreaterThan(k18);
  });

  it("prices a short junior below a long one", () => {
    const short = unitCost({ level: "Junior", carbon: "24K", size: 50 } as never);
    const long = unitCost({ level: "Junior", carbon: "24K", size: 56 } as never);
    expect(short).toBeLessThan(long);
  });

  it("stays below MSRP at every level — a negative margin would be a bug", () => {
    for (const level of ["Junior", "Intermediate", "Senior"] as const) {
      for (const carbon of ["18K", "24K"] as const) {
        const line = { level, carbon, size: 60 } as never;
        expect(unitCost(line)).toBeLessThan(unitMsrp(line));
      }
    }
  });
});

describe("goalie pricing", () => {
  it("steps by paddle length", () => {
    expect(goalieMsrp(22)).toBe(195);
    expect(goalieMsrp(24)).toBe(245);
    expect(goalieMsrp(26)).toBe(285);
  });

  it("treats the boundaries as the cheaper tier", () => {
    expect(goalieMsrp(21)).toBe(195);
    expect(goalieMsrp(23)).toBe(245);
    expect(goalieMsrp(25)).toBe(285);
  });

  it("costs less than it sells for at every paddle", () => {
    for (const paddle of [22, 24, 26]) {
      expect(goalieUnitCost(paddle)).toBeLessThan(goalieMsrp(paddle));
    }
  });

  it("falls back to the nearest known paddle rather than throwing", () => {
    expect(Number.isFinite(goalieUnitCost(23))).toBe(true);
    expect(Number.isFinite(goalieUnitCost(99))).toBe(true);
  });
});

describe("channelPrice — what each channel actually pays", () => {
  const msrp = 285;

  it("charges full price direct to consumer", () => {
    expect(channelPrice(msrp, "Senior", "dtc")).toBe(285);
  });

  it("discounts team 15% and wholesale 30%", () => {
    expect(channelPrice(msrp, "Senior", "team")).toBeCloseTo(242.25, 2);
    expect(channelPrice(msrp, "Senior", "wholesale")).toBeCloseTo(199.5, 2);
  });

  it("applies the SFS tier by level", () => {
    expect(channelPrice(msrp, "Senior", "sfs")).toBeCloseTo(285 * 0.52, 2);
    expect(channelPrice(msrp, "Intermediate", "sfs")).toBeCloseTo(285 * 0.57, 2);
    expect(channelPrice(msrp, "Junior", "sfs")).toBeCloseTo(285 * 0.55, 2);
  });

  it("treats goalie on the senior SFS tier", () => {
    expect(channelPrice(msrp, "Goalie", "sfs")).toBe(channelPrice(msrp, "Senior", "sfs"));
  });

  it("never prices a discount channel above DTC", () => {
    for (const ch of ["team", "wholesale", "sfs"] as const) {
      expect(channelPrice(msrp, "Senior", ch)).toBeLessThan(
        channelPrice(msrp, "Senior", "dtc")
      );
    }
  });
});
