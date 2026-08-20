import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  TOOLS,
  GROUP_LABELS,
  GROUP_ORDER,
  mergeToolsByHref,
  toolsForOwner,
} from "./tool-registry";

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

// ── Reachability from the page people actually use ────────────────────────
//
// The registry made a tool reachable from /org/[id]. The agent DASHBOARD read a
// separate hand-kept array on the persona, and Penny has no such array — so a
// tool registered to her rendered nowhere she would ever look. Stuck Orders
// shipped invisible that way, and the notes box twice before it.
//
// The dashboard now merges the two. These pin the merge.

describe("mergeToolsByHref", () => {
  const registry = [{ label: "Stuck Orders", href: "/accounting/stuck-orders" }];

  it("returns registry tools when the persona has no list at all", () => {
    // Penny's exact case: taskTypes, no tools array.
    expect(mergeToolsByHref(registry, undefined)).toEqual(registry);
  });

  it("keeps persona-only tools, so migrating a page drops nothing", () => {
    const persona = [{ label: "Review Queue", href: "/review" }];
    expect(mergeToolsByHref(registry, persona).map((t) => t.href)).toEqual([
      "/accounting/stuck-orders",
      "/review",
    ]);
  });

  it("shows a tool once when both lists have it, and prefers the registry's", () => {
    const persona = [
      { label: "Stuck Orders (stale label)", href: "/accounting/stuck-orders" },
    ];
    const merged = mergeToolsByHref(registry, persona);
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe("Stuck Orders");
  });

  it("treats a trailing slash as the same page", () => {
    expect(
      mergeToolsByHref(registry, [{ label: "Dupe", href: "/accounting/stuck-orders/" }])
    ).toHaveLength(1);
  });

  it("keeps a fragment as part of the destination", () => {
    // /org#marketing lands somewhere /org does not.
    expect(
      mergeToolsByHref(
        [{ label: "Org", href: "/org" }],
        [{ label: "Marketing", href: "/org#marketing" }]
      )
    ).toHaveLength(2);
  });

  it("drops an entry with no href rather than rendering a dead link", () => {
    expect(mergeToolsByHref([], [{ label: "Broken", href: "  " }])).toHaveLength(0);
  });

  it("handles both lists being empty", () => {
    expect(mergeToolsByHref([], undefined)).toEqual([]);
  });
});

describe("owners", () => {
  it("gives Penny her stuck-orders queue", () => {
    expect(toolsForOwner("accounting").map((t) => t.href)).toContain(
      "/accounting/stuck-orders"
    );
  });
});
