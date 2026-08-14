import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ProductionBatch } from "./production-batches";
import type { PreorderIndex } from "./preorder-rows";

// This module appends hundreds of rows to the sheet the storefront sells from.
// Everything it promises — write once, refuse on a bad read, record only what
// landed — was guaranteed by reading it carefully. These make it checkable.
//
// Zoho and KV are faked so the behaviour under test is the decision logic, not
// the network: what gets written, how often, and what happens when a call fails.

const sheet = vi.hoisted(() => ({
  appended: [] as { tab: string; rows: Record<string, string>[] }[],
  updated: [] as { tab: string; criteria: string; data: Record<string, string> }[],
  readFails: false,
  appendFails: false,
}));

const store = vi.hoisted(() => ({
  batches: [] as ProductionBatch[],
  index: {} as PreorderIndex,
}));

vi.mock("./zoho-sheet", () => ({
  fetchAllStickRecords: async () => {
    if (sheet.readFails) throw new Error("Zoho unavailable");
    return [];
  },
  appendSheetRows: async (tab: string, rows: Record<string, string>[]) => {
    if (sheet.appendFails) throw new Error("append rejected");
    sheet.appended.push({ tab, rows });
    return { added: rows.length };
  },
  updateSheetRow: async (tab: string, criteria: string, data: Record<string, string>) => {
    sheet.updated.push({ tab, criteria, data });
  },
}));

vi.mock("./production-batches", async (importOriginal) => {
  // specKey and describeSpec are pure and part of what's being tested — only
  // the KV-backed reads and writes are faked.
  const actual = await importOriginal<typeof import("./production-batches")>();
  return {
    ...actual,
    listBatches: async () => store.batches,
    setLineBaseColor: async (batchId: string, oldKey: string, colour: string) => {
      const batch = store.batches.find((b) => b.id === batchId)!;
      const line = batch.lines.find((l) => actual.specKey(l) === oldKey)!;
      line.baseColor = colour;
      return { oldSpecKey: oldKey, newSpecKey: actual.specKey(line), merged: false };
    },
  };
});

vi.mock("./preorder-rows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./preorder-rows")>();
  return {
    ...actual,
    listPreorderRows: async () => store.index,
    nextPreorderNumber: async () => {
      let max = 0;
      for (const id of Object.keys(store.index)) {
        const n = Number(id.slice("PROD-".length));
        if (Number.isFinite(n) && n > max) max = n;
      }
      return max + 1;
    },
    recordPreorderRows: async (rows: { preorderId: string }[]) => {
      for (const r of rows) store.index[r.preorderId] = r as never;
    },
    respecPreorderRows: async (batchId: string, oldKey: string, newKey: string) => {
      const moved = Object.values(store.index).filter(
        (r) => r.batchId === batchId && r.specKey === oldKey && !r.serial
      );
      for (const r of moved) r.specKey = newKey;
      return moved;
    },
  };
});

const { writePreorderRows, previewPreorderRows, backfillBlankBaseColors } =
  await import("./preorder-writer");

function line(over: Partial<ProductionBatch["lines"][number]> = {}) {
  return {
    level: "Senior", size: "66", carbon: "24K", kickPoint: "Mid", hand: "Left",
    flex: "80", curve: "T28M", baseColor: "Black", decalColor: "Halo",
    quantity: 3, received: 0, ...over,
  };
}

function batch(over: Partial<ProductionBatch> = {}): ProductionBatch {
  return {
    id: "prod-1", label: "TILT August 2026", expectedDate: "2026-09-15",
    createdAt: "2026-08-01T00:00:00.000Z", createdBy: "Chris",
    lines: [line()], ...over,
  };
}

beforeEach(() => {
  sheet.appended = [];
  sheet.updated = [];
  sheet.readFails = false;
  sheet.appendFails = false;
  store.batches = [batch()];
  store.index = {};
});

describe("writePreorderRows", () => {
  it("writes one row per outstanding stick", async () => {
    const result = await writePreorderRows("prod-1");
    expect(result.written).toBe(3);
    expect(sheet.appended[0].rows).toHaveLength(3);
  });

  it("stamps each row as In Production with a PROD placeholder", async () => {
    await writePreorderRows("prod-1");
    const rows = sheet.appended[0].rows;
    for (const r of rows) {
      expect(r.Status).toBe("In Production");
      expect(r["Serial Number"]).toMatch(/^PROD-\d{4}$/);
      expect(r["Date Sold"]).toBe("");
    }
    // Ids are unique — two sticks sharing a placeholder would be one row on the
    // sheet and one customer disappointed.
    expect(new Set(rows.map((r) => r["Serial Number"])).size).toBe(3);
  });

  it("carries the spec onto the row so the storefront can render it", async () => {
    await writePreorderRows("prod-1");
    const row = sheet.appended[0].rows[0];
    expect(row.Level).toBe("Senior");
    expect(row["Base Color"]).toBe("Black");
    expect(row["Decal Color"]).toBe("Halo");
    expect(row.Flex).toBe("80");
  });

  it("only counts what hasn't arrived yet", async () => {
    store.batches = [batch({ lines: [line({ quantity: 5, received: 2 })] })];
    const result = await writePreorderRows("prod-1");
    expect(result.written).toBe(3);
  });

  describe("clicking the button twice", () => {
    it("writes nothing the second time", async () => {
      const first = await writePreorderRows("prod-1");
      expect(first.written).toBe(3);

      sheet.appended = [];
      const second = await writePreorderRows("prod-1");

      // The failure this prevents is 424 sticks on the storefront.
      expect(second.written).toBe(0);
      expect(second.alreadyWritten).toBe(3);
      expect(sheet.appended).toHaveLength(0);
    });

    it("tops up rather than restarting when the batch grew", async () => {
      await writePreorderRows("prod-1");
      store.batches[0].lines[0].quantity = 5;

      sheet.appended = [];
      const result = await writePreorderRows("prod-1");
      expect(result.written).toBe(2);
      expect(result.alreadyWritten).toBe(3);
    });
  });

  describe("refusing to write", () => {
    it("won't append when the live sheet can't be read", async () => {
      sheet.readFails = true;
      await expect(writePreorderRows("prod-1")).rejects.toThrow(/couldn't be read/i);
      // A blind append is how you get a second copy of every stick.
      expect(sheet.appended).toHaveLength(0);
    });

    it("records nothing when the append itself fails", async () => {
      sheet.appendFails = true;
      await expect(writePreorderRows("prod-1")).rejects.toThrow();
      // The index must not claim rows the sheet never accepted, or the next run
      // would skip them and they'd never exist.
      expect(Object.keys(store.index)).toHaveLength(0);
    });

    it("rejects an unknown batch", async () => {
      await expect(writePreorderRows("nope")).rejects.toThrow(/no production batch/i);
    });

    it("rejects a closed batch", async () => {
      store.batches = [batch({ closedAt: "2026-08-10T00:00:00.000Z" })];
      await expect(writePreorderRows("prod-1")).rejects.toThrow(/closed/i);
    });
  });

  it("sends goalie sticks to the Goalie tab and players to Player", async () => {
    store.batches = [
      batch({
        lines: [
          line({ quantity: 2 }),
          line({ level: "Goalie Sr", quantity: 1, curve: "G1" }),
        ],
      }),
    ];
    await writePreorderRows("prod-1");
    const tabs = Object.fromEntries(
      sheet.appended.map((a) => [a.tab, a.rows.length])
    );
    expect(tabs).toEqual({ Player: 2, Goalie: 1 });
  });
});

describe("previewPreorderRows", () => {
  it("reports the count without touching the sheet", async () => {
    const preview = await previewPreorderRows("prod-1");
    expect(preview.toWrite).toBe(3);
    expect(preview.alreadyWritten).toBe(0);
    expect(sheet.appended).toHaveLength(0);
  });

  it("agrees with what the write then does", async () => {
    const preview = await previewPreorderRows("prod-1");
    const result = await writePreorderRows("prod-1");
    // The confirm dialog quotes this number before writing to live inventory.
    expect(result.written).toBe(preview.toWrite);
  });
});

describe("backfillBlankBaseColors", () => {
  beforeEach(() => {
    store.batches = [batch({ lines: [line({ baseColor: "" })] })];
  });

  it("fills blanks on the batch and the rows already written", async () => {
    await writePreorderRows("prod-1");
    const result = await backfillBlankBaseColors("prod-1");

    expect(result.specsFixed).toBe(1);
    expect(result.rowsUpdated).toBe(3);
    expect(store.batches[0].lines[0].baseColor).toBe("Black");
    for (const u of sheet.updated) expect(u.data["Base Color"]).toBe("Black");
  });

  it("re-points the spec key so the shipment can still match", async () => {
    await writePreorderRows("prod-1");
    const before = Object.values(store.index)[0].specKey;
    await backfillBlankBaseColors("prod-1");
    const after = Object.values(store.index)[0].specKey;
    // Without this the arriving stick matches nothing and gets appended as a
    // duplicate instead of filling its pre-order row.
    expect(after).not.toBe(before);
    expect(after).toContain("black");
  });

  it("does nothing when no colours are missing", async () => {
    store.batches = [batch()];
    const result = await backfillBlankBaseColors("prod-1");
    expect(result.specsFixed).toBe(0);
    expect(sheet.updated).toHaveLength(0);
  });
});
