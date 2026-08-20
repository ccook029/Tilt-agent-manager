import { describe, it, expect, vi, beforeEach } from "vitest";

// Marking H2512-05979 sold failed with "Failed to delete from Player Stick
// sheet:" — a message with nothing after the colon, because it reported
// response.statusText, which is empty over HTTP/2.
//
// The delete was the second half of copy-then-delete. The copy had already
// succeeded, so the stick ended up recorded as sold AND still listed for sale.
// Worse, had the delete worked it would have removed the row entirely — and
// every other part of the system reads a sale as Status "Sold" on the row that
// stays put.
//
// So this pins the shape of the operation, not just its success.

const SHEET = "Player";
const SERIAL = "H2512-05979";

interface Call {
  url: string;
  body: URLSearchParams;
}

function mockZoho(opts: { status?: string; updateFails?: boolean } = {}) {
  const calls: Call[] = [];

  const reply = (payload: unknown, ok = true, code = 200) =>
    Promise.resolve({
      ok,
      status: code,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response);

  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input);
      const body = new URLSearchParams(String(init?.body ?? ""));
      calls.push({ url, body });

      if (url.includes("oauth")) return reply({ access_token: "tok" });

      const method = body.get("method") ?? "";
      if (url.includes("records.fetch") || method === "worksheet.records.fetch") {
        return reply({
          status: "success",
          records: [
            {
              row_index: 42,
              Level: "Senior",
              "Size (inch)": "66",
              Carbon: "18K",
              "Kick Point": "MID",
              Hand: "Left",
              Flex: "85",
              Curve: "T92M",
              "Base Color": "Black",
              "Decal Color": "Halo",
              "Serial Number": SERIAL,
              Price: "265",
              Status: opts.status ?? "Available",
              "Date Sold": "",
            },
          ],
        });
      }

      if (method === "worksheet.records.update") {
        return opts.updateFails
          ? reply({ status: "failure", error_message: "no such column" })
          : reply({ status: "success" });
      }

      throw new Error(`unexpected call: ${url} ${method}`);
    })
  );

  return calls;
}

async function load() {
  process.env.ZOHO_WORKBOOK_ID = "wb_1";
  process.env.ZOHO_PLAYER_STICK_SHEET = SHEET;
  process.env.ZOHO_REFRESH_TOKEN = "rt";
  process.env.ZOHO_CLIENT_ID = "cid";
  process.env.ZOHO_CLIENT_SECRET = "secret";
  return import("./zoho");
}

const writes = (calls: Call[]) =>
  calls.filter((c) => c.body.get("method") === "worksheet.records.update");

describe("markAsSold", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("flags the row in place instead of moving it", async () => {
    const calls = mockZoho();
    const { markAsSold } = await load();

    const result = await markAsSold(SERIAL);

    expect(result.success).toBe(true);
    const update = writes(calls);
    expect(update).toHaveLength(1);
    expect(update[0].body.get("worksheet_name")).toBe(SHEET);
    expect(JSON.parse(update[0].body.get("data")!)).toMatchObject({ Status: "Sold" });
  });

  it("stamps the date sold", async () => {
    const calls = mockZoho();
    const { markAsSold } = await load();
    await markAsSold(SERIAL);

    const data = JSON.parse(writes(calls)[0].body.get("data")!);
    expect(data["Date Sold"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("targets the row by serial, not by row number", async () => {
    // A row index goes stale the moment anyone inserts a row above it, and the
    // old delete used one.
    const calls = mockZoho();
    const { markAsSold } = await load();
    await markAsSold(SERIAL);

    expect(writes(calls)[0].body.get("criteria")).toBe(`"Serial Number" = "${SERIAL}"`);
  });

  it("never deletes anything, and never writes to another tab", async () => {
    const calls = mockZoho();
    const { markAsSold } = await load();
    await markAsSold(SERIAL);

    const methods = calls.map((c) => c.body.get("method") ?? c.url);
    expect(methods.some((m) => String(m).includes("delete"))).toBe(false);
    expect(methods.some((m) => String(m).includes("records.add"))).toBe(false);
  });

  it("is a no-op on a stick that already sold", async () => {
    const calls = mockZoho({ status: "Sold" });
    const { markAsSold } = await load();

    const result = await markAsSold(SERIAL);

    expect(result.success).toBe(true);
    expect(writes(calls)).toHaveLength(0);
  });

  it("reports what Zoho actually said when the write fails", async () => {
    // The whole reason this bug was hard to read: the old message ended at the
    // colon because statusText is empty over HTTP/2.
    mockZoho({ updateFails: true });
    const { markAsSold } = await load();

    await expect(markAsSold(SERIAL)).rejects.toThrow(/no such column/);
  });

  it("says so plainly when the serial isn't on the sheet", async () => {
    const calls = mockZoho();
    const { markAsSold } = await load();

    const result = await markAsSold("H9999-00000");

    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
    expect(writes(calls)).toHaveLength(0);
  });
});
