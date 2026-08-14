import { describe, it, expect } from "vitest";
import { parseWebChanges } from "./ship-executors";

// This parser decides whether an approved website change reaches the site or
// quietly doesn't. Everything it rejects has to be counted, because a rejection
// nobody hears about is indistinguishable from there being nothing to do.

const block = (body: string) => "```webchange\n" + body + "\n```";

describe("parseWebChanges", () => {
  it("reads a well-formed block", () => {
    const { changes, rejected } = parseWebChanges(
      "Here's the change.\n" +
        block(
          JSON.stringify({
            path: "src/data/products.ts",
            title: "Add fresh stick drop",
            request: "Add the new colourway to the senior line.",
          })
        )
    );
    expect(rejected).toBe(0);
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe("src/data/products.ts");
    expect(changes[0].title).toBe("Add fresh stick drop");
  });

  it("reads several blocks in one deliverable", () => {
    const one = block(JSON.stringify({ path: "a.ts", title: "A", request: "do a" }));
    const two = block(JSON.stringify({ path: "b.ts", title: "B", request: "do b" }));
    const { changes, rejected } = parseWebChanges(`intro\n${one}\nmiddle\n${two}\nend`);
    expect(changes).toHaveLength(2);
    expect(rejected).toBe(0);
  });

  it("trims whitespace off the fields", () => {
    const { changes } = parseWebChanges(
      block(JSON.stringify({ path: "  a.ts  ", title: " A ", request: " do a " }))
    );
    expect(changes[0]).toEqual({ path: "a.ts", title: "A", request: "do a" });
  });

  describe("a deliverable with no block at all", () => {
    it("reports nothing to do, and nothing rejected", () => {
      // Research and advice orders are legitimately blockless — the document is
      // the product. The caller distinguishes this from a failed block.
      const { changes, rejected } = parseWebChanges(
        "I looked at the drop and recommend we lead with the Halo colourway."
      );
      expect(changes).toHaveLength(0);
      expect(rejected).toBe(0);
    });
  });

  describe("blocks it must refuse — and count", () => {
    it("counts a block that isn't valid JSON", () => {
      const { changes, rejected } = parseWebChanges(block("{ path: 'a.ts', "));
      expect(changes).toHaveLength(0);
      expect(rejected).toBe(1);
    });

    it.each([
      ["path", { title: "A", request: "do a" }],
      ["title", { path: "a.ts", request: "do a" }],
      ["request", { path: "a.ts", title: "A" }],
    ])("counts a block missing %s", (_field, body) => {
      const { changes, rejected } = parseWebChanges(block(JSON.stringify(body)));
      expect(changes).toHaveLength(0);
      expect(rejected).toBe(1);
    });

    it("counts a block whose fields are only whitespace", () => {
      const { changes, rejected } = parseWebChanges(
        block(JSON.stringify({ path: "   ", title: "A", request: "do a" }))
      );
      expect(changes).toHaveLength(0);
      expect(rejected).toBe(1);
    });

    it("keeps the good block and still counts the bad one", () => {
      // The partial case: one PR opens, and without the count the other change
      // vanishes behind a note saying something shipped.
      const good = block(JSON.stringify({ path: "a.ts", title: "A", request: "do a" }));
      const bad = block("not json at all");
      const { changes, rejected } = parseWebChanges(`${good}\n${bad}`);
      expect(changes).toHaveLength(1);
      expect(rejected).toBe(1);
    });
  });
});
