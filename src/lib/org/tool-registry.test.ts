import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { TOOLS, GROUP_LABELS, GROUP_ORDER } from "./tool-registry";

// tool-registry.ts opens by saying its whole discipline is "adding a page? add
// it here in the same commit". That catches a page missing from the registry.
// It can't catch the inverse — a registry entry pointing at a page that isn't
// there, or was moved — which reads to an agent or the index as a real
// destination right up until someone clicks it.
//
// An audit found none of these. This is what keeps it that way.

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function pageExists(href: string): boolean {
  const clean = href.split("?")[0].replace(/\/$/, "");
  return [
    `src/app${clean}/page.tsx`,
    `src/app${clean}/page.ts`,
    `src/app${clean}/route.ts`,
  ].some((p) => existsSync(path.join(repoRoot, p)));
}

const internal = TOOLS.filter((t) => !t.external && t.href.startsWith("/"));

describe("tool registry", () => {
  it("has tools to check", () => {
    expect(internal.length).toBeGreaterThan(10);
  });

  it.each(internal.map((t) => [t.label, t.href] as const))(
    "%s (%s) resolves to a real page",
    (_label, href) => {
      expect(pageExists(href)).toBe(true);
    }
  );

  it("registers each href once", () => {
    const hrefs = TOOLS.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("gives every tool a label and a description", () => {
    for (const t of TOOLS) {
      expect(t.label.trim()).not.toBe("");
      expect(t.description.trim()).not.toBe("");
    }
  });

  it("puts every tool in a group the UI can render", () => {
    for (const t of TOOLS) {
      expect(GROUP_ORDER).toContain(t.group);
      expect(GROUP_LABELS[t.group]).toBeTruthy();
    }
  });

  it("orders every group exactly once", () => {
    expect(new Set(GROUP_ORDER).size).toBe(GROUP_ORDER.length);
    expect(GROUP_ORDER.length).toBe(Object.keys(GROUP_LABELS).length);
  });

  it("gives a tab label to anything that sits in a section", () => {
    // A sectioned tool with no tabLabel silently vanishes from that tab strip,
    // which is the failure the registry was built to end.
    for (const t of TOOLS) {
      if (t.section) expect(t.tabLabel?.trim()).toBeTruthy();
    }
  });
});
