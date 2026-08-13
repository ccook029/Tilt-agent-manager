// ---------------------------------------------------------------------------
// Stick Inventory module layout — the absorbed tiltinventory app running
// natively at /inventory. The hub's root layout provides the global chrome
// (header, aurora backdrop, max-w-6xl main); this layout adds the module's
// title row. The tabs come from the shared tool registry, so a tool can't be
// present here and missing from Stockton's page.
// ---------------------------------------------------------------------------
import type { Metadata } from "next";
import SectionNav from "@/components/section-nav";

export const metadata: Metadata = {
  title: { default: "Stick Inventory", template: "%s · Stick Inventory · Tilt HQ" },
};

export default function StickInventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-gray-600">
          Tilt OS
        </p>
        <h1 className="text-3xl font-semibold">Stick Inventory</h1>
        <p className="text-gray-500 mt-1 max-w-2xl">
          Everything Stockton runs: what&apos;s on hand, receiving new stock,
          building the next factory order, and keeping the Zoho catalog clean.
        </p>
      </div>
      <SectionNav section="inventory" ariaLabel="Stick Inventory" />
      {children}
    </div>
  );
}
