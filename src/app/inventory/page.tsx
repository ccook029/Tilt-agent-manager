"use client";

// ---------------------------------------------------------------------------
// /inventory — the stick inventory table. Ported from tiltinventory's home
// page; fetches through the hub's /api/sticks/* routes and shows a setup note
// (instead of an error) when the Zoho Sheet workbook isn't configured yet.
// ---------------------------------------------------------------------------
import { useState, useEffect, useCallback } from "react";
import { HockeyStick } from "@/lib/sticks/types";
import InventoryTable from "@/components/sticks/InventoryTable";

export default function StickInventoryPage() {
  const [sticks, setSticks] = useState<HockeyStick[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [sellingSerial, setSellingSerial] = useState<string | null>(null);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotConfigured(false);
    try {
      const res = await fetch("/api/sticks/inventory");
      const data = await res.json();
      if (data.success) {
        setSticks(data.sticks);
      } else if (data.configured === false) {
        setNotConfigured(true);
      } else {
        setError(data.message || "Failed to load inventory");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const handleSell = async (serialNumber: string) => {
    if (!confirm(`Are you sure you want to mark ${serialNumber} as SOLD?\n\nThis will move the stick to the Sold Stick sheet.`)) {
      return;
    }

    setSellingSerial(serialNumber);
    try {
      const res = await fetch("/api/sticks/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial_number: serialNumber }),
      });
      const data = await res.json();

      if (data.success) {
        alert(`Stick ${serialNumber} marked as SOLD.`);
        setSticks((prev) => prev.filter((s) => s.serial_number !== serialNumber));
      } else {
        alert(`Failed: ${data.message}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSellingSerial(null);
    }
  };

  if (notConfigured && !loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-200">Player Stick Inventory</h2>
            <p className="text-sm text-gray-500 mt-1">
              Browse available sticks and mark them as sold
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 overflow-hidden">
          <p className="px-5 py-8 text-sm text-gray-600">
            Stick inventory isn&apos;t connected yet — set{" "}
            <code className="bg-gray-800/80 rounded px-1.5 py-0.5 text-gray-400">
              ZOHO_WORKBOOK_ID
            </code>{" "}
            (plus the ZOHO_* OAuth vars) to link the Zoho Sheet stick workbook,
            then redeploy. See .env.example for the full list.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-200">Player Stick Inventory</h2>
          <p className="text-sm text-gray-500 mt-1">
            Browse available sticks and mark them as sold
          </p>
        </div>
        <button
          onClick={fetchInventory}
          disabled={loading}
          className="bg-[#101010] border border-gray-800 text-gray-300 py-2 px-4 rounded-lg text-sm font-medium
            hover:border-gray-700 hover:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#00d6ff]/50
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Refresh
        </button>
      </div>

      <InventoryTable
        sticks={sticks}
        loading={loading}
        error={error}
        onSell={handleSell}
        sellingSerial={sellingSerial}
      />
    </div>
  );
}
