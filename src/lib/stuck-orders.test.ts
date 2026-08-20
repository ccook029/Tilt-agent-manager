import { describe, it, expect } from "vitest";
import { describeRetry } from "./stuck-orders";

// This sentence is the whole feedback the button gives. If it reads as success
// when a leg failed, Penny ticks the order off and the paperwork still is not
// there — which is exactly how TILT-5889 stayed invisible in the first place.

describe("describeRetry", () => {
  it("names both documents when the sync worked", () => {
    expect(
      describeRetry({
        ok: true,
        invoice: { success: true, number: "INV-000123", alreadyExisted: false, error: null },
        salesOrder: { success: true, number: "TILT-5889", alreadyExisted: false, error: null },
      })
    ).toBe("Invoice INV-000123 · Sales order TILT-5889");
  });

  it("says when something was already there rather than implying it just made it", () => {
    expect(
      describeRetry({
        ok: true,
        invoice: { success: true, number: "INV-000123", alreadyExisted: true, error: null },
        salesOrder: { success: true, number: "TILT-5889", alreadyExisted: false, error: null },
      })
    ).toBe("Invoice INV-000123 (already existed) · Sales order TILT-5889");
  });

  it("reports the half that failed, with Zoho's reason", () => {
    const msg = describeRetry({
      ok: false,
      invoice: { success: true, number: "INV-000123", alreadyExisted: true, error: null },
      salesOrder: {
        success: false,
        number: null,
        alreadyExisted: false,
        error: '{"code":4097,"message":"Number entered does not match..."}',
      },
    });
    expect(msg).toContain("Sales order failed");
    expect(msg).toContain("4097");
  });

  it("does not claim success when a leg failed with no reason given", () => {
    const msg = describeRetry({
      ok: false,
      salesOrder: { success: false, number: null, alreadyExisted: false, error: null },
    });
    expect(msg).toBe("Sales order failed — no reason given");
  });

  it("passes a transport error straight through", () => {
    expect(describeRetry({ ok: false, error: "tiltweb returned 401." })).toBe(
      "tiltweb returned 401."
    );
  });

  it("says something rather than nothing when the response is empty", () => {
    expect(describeRetry({ ok: false })).toBe("Nothing came back.");
  });
});
