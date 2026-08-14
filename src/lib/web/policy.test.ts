import { describe, it, expect } from "vitest";
import { classifyPath, touchesMoney } from "./policy";

// The one place where "can an agent change the live storefront unattended" is
// decided. Its own header says it should be provable without a network call —
// this is that proof.

const auto = (p: string) => classifyPath(p).autoMergeable;

describe("what Nova may merge on her own", () => {
  it.each([
    "src/data/products.ts",
    "src/data/stickColors.ts",
    "src/data/stickImages.ts",
    "src/data/announcements.ts",
    "public/images/sticks/x1-senior.png",
    "public/llms.txt",
    "public/robots.txt",
  ])("allows %s", (path) => {
    expect(auto(path)).toBe(true);
  });

  it("allows the announcement bar copy, so a drop isn't a developer task", () => {
    const verdict = classifyPath("src/data/announcements.ts");
    expect(verdict.autoMergeable).toBe(true);
    expect(verdict.reason).toBeUndefined();
  });
});

describe("what she may never merge on her own", () => {
  it.each([
    ["src/app/api/checkout/route.ts", "an API route"],
    ["src/app/checkout/page.tsx", "the checkout page"],
    ["src/lib/validate-order-amount.ts", "server-side logic"],
    ["src/middleware.ts", "middleware"],
    ["package.json", "dependencies"],
    ["next.config.ts", "build config"],
    ["vercel.json", "deploy config"],
    ["supabase/migrations/001.sql", "the database"],
    [".github/workflows/ci.yml", "CI"],
  ])("denies %s (%s)", (path) => {
    expect(auto(path)).toBe(false);
  });

  it.each([
    "src/components/StripePaymentForm.tsx",
    "src/app/admin/orders/page.tsx",
    "src/data/accessCodes.ts",
    "src/components/PriceCallout.tsx",
  ])("denies %s wherever it lives, on the word alone", (path) => {
    // Belt and braces: the deny list also matches money and auth words in any
    // path, so a new file in a new directory doesn't quietly open a hole.
    expect(auto(path)).toBe(false);
  });

  it("denies anything it simply doesn't recognise", () => {
    const verdict = classifyPath("src/components/AnnouncementBar.tsx");
    expect(verdict.autoMergeable).toBe(false);
    expect(verdict.reason).toMatch(/outside the content/i);
  });
});

describe("deny beats allow", () => {
  it("keeps a denied path denied even when an allow rule would match", () => {
    // This is the real safety property: adding to ALLOW can never accidentally
    // open up checkout, because DENY is checked first and wins.
    const verdict = classifyPath("public/images/checkout/banner.png");
    expect(verdict.autoMergeable).toBe(false);
    expect(verdict.reason).toMatch(/order, payment, or server-side/i);
  });
});

describe("path handling", () => {
  it("ignores a leading slash", () => {
    expect(auto("/src/data/products.ts")).toBe(true);
    expect(auto("/src/app/api/checkout/route.ts")).toBe(false);
  });

  it("doesn't allow a lookalike outside the exact file", () => {
    expect(auto("src/data/products.test.ts")).toBe(false);
    expect(auto("src/data/products-new.ts")).toBe(false);
    expect(auto("other/src/data/products.ts")).toBe(false);
  });
});

describe("touchesMoney — the label on a merged change", () => {
  it("spots a changed price field", () => {
    expect(touchesMoney("+  price: 285.0,")).toBe(true);
    expect(touchesMoney("-  comparePrice: 199,")).toBe(true);
  });

  it("spots a bare number, which is how priceModifiers change", () => {
    // Inner lines like `"70\\"": 10` never contain the word price.
    expect(touchesMoney('+    "70\\"": 10,')).toBe(true);
    expect(touchesMoney("+    24.99,")).toBe(true);
  });

  it("ignores context lines and diff headers", () => {
    expect(touchesMoney("   price: 285.0,")).toBe(false);
    expect(touchesMoney("+++ b/src/data/products.ts")).toBe(false);
    expect(touchesMoney("--- a/src/data/products.ts")).toBe(false);
  });

  it("stays quiet on a pure copy change", () => {
    const patch = [
      "+++ b/src/data/announcements.ts",
      '+    headline: "Fresh drop —",',
      '+    detail: "New colourways just landed.",',
      '-    detail: "Register your Tilt stick",',
    ].join("\n");
    expect(touchesMoney(patch)).toBe(false);
  });
});
