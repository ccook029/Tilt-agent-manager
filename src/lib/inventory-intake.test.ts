import { describe, it, expect } from "vitest";
import {
  normalizeBaseColor,
  normalizeSerial,
  normalizeSize,
  normalizeHand,
} from "./inventory-intake";
import { specKey, aggregateLines } from "./production-batches";

// These are the rules the model is NOT allowed to decide, which is exactly why
// they're worth pinning: a wrong answer here doesn't look like a wrong answer,
// it looks like inventory.

describe("normalizeBaseColor — a blank stick colour means black", () => {
  it("reads an empty cell as Black", () => {
    // The factory sheet only fills its "Stick color" column for the exceptions
    // ("White" on a few rows). Empty is the default shaft, not missing data.
    expect(normalizeBaseColor("")).toBe("Black");
    expect(normalizeBaseColor("   ")).toBe("Black");
  });

  it("leaves a stated colour alone", () => {
    expect(normalizeBaseColor("White")).toBe("White");
    expect(normalizeBaseColor("  White  ")).toBe("White");
  });

  it("makes an ordered stick match the one that arrives", () => {
    // The reason this rule exists. specKey is what a received stick is matched
    // against, so a blank colour on the order and "Black" on the arrival would
    // never meet — and the shipment would append a duplicate row instead of
    // filling the pre-order in.
    const ordered = {
      level: "Senior", size: "66", carbon: "24K", kickPoint: "Mid",
      hand: "Left", flex: "80", curve: "T28M",
      baseColor: normalizeBaseColor(""), decalColor: "Halo",
    };
    const arrived = { ...ordered, baseColor: normalizeBaseColor("Black") };
    expect(specKey(ordered)).toBe(specKey(arrived));
  });

  it("keeps a white stick distinct from a black one", () => {
    const base = {
      level: "Junior", size: "56", carbon: "24K", kickPoint: "Mid",
      hand: "Right", flex: "40", curve: "T92M", decalColor: "Halo",
    };
    expect(specKey({ ...base, baseColor: normalizeBaseColor("") }))
      .not.toBe(specKey({ ...base, baseColor: normalizeBaseColor("White") }));
  });
});

describe("normalizeSerial — dedupe only means something if this holds", () => {
  it("repairs the shapes the factory sheet actually produces", () => {
    expect(normalizeSerial("H2607- 09904")).toBe("H2607-09904");
    expect(normalizeSerial("h260709904")).toBe("H2607-09904");
    expect(normalizeSerial("H2607-09904")).toBe("H2607-09904");
  });

  it("treats those three as the same stick", () => {
    const forms = ["H2607- 09904", "h260709904", "H2607-09904"];
    expect(new Set(forms.map(normalizeSerial)).size).toBe(1);
  });

  it("returns empty for a row with no serial", () => {
    expect(normalizeSerial("")).toBe("");
    expect(normalizeSerial("   ")).toBe("");
  });
});

describe("normalizeSize / normalizeHand", () => {
  it("strips inch marks the sheet stores as bare numbers", () => {
    expect(normalizeSize('58"')).toBe("58");
    expect(normalizeSize("58”")).toBe("58");
    expect(normalizeSize("58 in")).toBe("58");
  });

  it("normalises hand so Left and left aren't two sticks", () => {
    expect(normalizeHand("left")).toBe("Left");
    expect(normalizeHand("L")).toBe("Left");
    expect(normalizeHand("right")).toBe("Right");
  });
});

describe("specKey", () => {
  it("ignores case and spacing, which vary between the two sheets", () => {
    const a = { level: "Senior", size: "66", carbon: "24K", kickPoint: "Mid",
      hand: "Left", flex: "80", curve: "T28M", baseColor: "Black", decalColor: "Halo" };
    const b = { ...a, level: "senior", hand: "  LEFT ", decalColor: "halo" };
    expect(specKey(a)).toBe(specKey(b));
  });

  it("separates sticks that differ in any one attribute", () => {
    const base = { level: "Senior", size: "66", carbon: "24K", kickPoint: "Mid",
      hand: "Left", flex: "80", curve: "T28M", baseColor: "Black", decalColor: "Halo" };
    const variants = [
      { ...base, flex: "75" },
      { ...base, hand: "Right" },
      { ...base, curve: "T92M" },
      { ...base, decalColor: "Black Halo" },
    ];
    const keys = new Set([base, ...variants].map(specKey));
    expect(keys.size).toBe(5);
  });
});

describe("aggregateLines — per-stick rows become quantities per spec", () => {
  it("rolls identical specs together and counts them", () => {
    const rows = [
      { level: "Senior", size: "66", carbon: "24K", kickPoint: "Mid", hand: "Left",
        flex: "80", curve: "T28M", baseColor: "Black", decalColor: "Halo" },
      { level: "Senior", size: "66", carbon: "24K", kickPoint: "Mid", hand: "Left",
        flex: "80", curve: "T28M", baseColor: "Black", decalColor: "Halo" },
      { level: "Junior", size: "56", carbon: "24K", kickPoint: "Mid", hand: "Right",
        flex: "40", curve: "T92M", baseColor: "White", decalColor: "Halo" },
    ];
    const lines = aggregateLines(rows);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.level === "Senior")?.quantity).toBe(2);
    expect(lines.find((l) => l.level === "Junior")?.quantity).toBe(1);
  });

  it("honours an explicit quantity rather than counting the row once", () => {
    const lines = aggregateLines([
      { level: "Senior", size: "66", carbon: "24K", kickPoint: "Mid", hand: "Left",
        flex: "80", curve: "T28M", baseColor: "Black", decalColor: "Halo", quantity: 8 },
    ]);
    expect(lines[0].quantity).toBe(8);
  });

  it("starts everything at zero received", () => {
    const lines = aggregateLines([
      { level: "Senior", size: "66", carbon: "24K", kickPoint: "Mid", hand: "Left",
        flex: "80", curve: "T28M", baseColor: "Black", decalColor: "Halo" },
    ]);
    expect(lines[0].received).toBe(0);
  });
});
