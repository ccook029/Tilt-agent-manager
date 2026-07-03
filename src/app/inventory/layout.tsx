// ---------------------------------------------------------------------------
// Stick Inventory module layout — the absorbed tiltinventory app running
// natively at /inventory. The hub's root layout provides the global chrome
// (header, aurora backdrop, max-w-6xl main); this layout adds the module's
// title row and its Inventory / Scan & Sell tabs.
// ---------------------------------------------------------------------------
import type { Metadata } from "next";
import InventoryNav from "./nav";

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
          Player stick stock straight from the Zoho Sheet — browse what&apos;s
          on hand, or scan a serial number to sell a stick on the spot.
        </p>
      </div>
      <InventoryNav />
      {children}
    </div>
  );
}
