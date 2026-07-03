"use client";

// ---------------------------------------------------------------------------
// /inventory/scan — scan a serial number (camera OCR, photo upload, or manual
// entry), look the stick up, and mark it sold. Ported from tiltinventory's
// /scan page; fetches through the hub's /api/sticks/* routes.
// ---------------------------------------------------------------------------
import { useState, useCallback } from "react";
import { HockeyStick } from "@/lib/sticks/types";
import Scanner from "@/components/sticks/Scanner";
import StickCard from "@/components/sticks/StickCard";

export default function ScanPage() {
  const [searchResult, setSearchResult] = useState<{
    found: boolean;
    stick?: HockeyStick;
    message: string;
    serial?: string;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [selling, setSelling] = useState(false);
  const [soldMessage, setSoldMessage] = useState<string | null>(null);

  const handleSerialDetected = useCallback(async (serial: string) => {
    setSearching(true);
    setSearchResult(null);
    setSoldMessage(null);

    try {
      const res = await fetch(`/api/sticks/search?serial=${encodeURIComponent(serial)}`);
      const data = await res.json();
      setSearchResult({ ...data, serial });
    } catch (err) {
      setSearchResult({
        found: false,
        message: err instanceof Error ? err.message : "Search failed",
        serial,
      });
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSell = useCallback(async (serialNumber: string) => {
    if (!confirm(`Are you sure you want to mark ${serialNumber} as SOLD?\n\nThis will move the stick to the Sold Stick sheet.`)) {
      return;
    }

    setSelling(true);
    try {
      const res = await fetch("/api/sticks/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial_number: serialNumber }),
      });
      const data = await res.json();

      if (data.success) {
        setSoldMessage(`Stick ${serialNumber} has been marked as SOLD and moved to the Sold Stick sheet.`);
        setSearchResult(null);
      } else {
        alert(`Failed: ${data.message}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSelling(false);
    }
  }, []);

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-200">Scan &amp; Sell</h2>
        <p className="text-sm text-gray-500 mt-1">
          Scan a serial number to look up a stick and mark it as sold
        </p>
      </div>

      <Scanner
        onSerialDetected={handleSerialDetected}
        disabled={searching || selling}
      />

      {/* Search Status */}
      {searching && (
        <div className="mt-6 bg-[#101010] border border-gray-800 rounded-xl p-4 flex items-center gap-3">
          <svg className="animate-spin h-5 w-5 text-[#00d6ff]" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-gray-300 text-sm font-medium">Searching inventory...</p>
        </div>
      )}

      {/* Sold confirmation */}
      {soldMessage && (
        <div className="mt-6 bg-green-950/20 border border-green-900/60 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-green-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-green-300 text-sm font-medium">{soldMessage}</p>
          </div>
          <button
            onClick={() => setSoldMessage(null)}
            className="mt-3 text-sm text-green-400 underline hover:text-green-200"
          >
            Scan another stick
          </button>
        </div>
      )}

      {/* Search Result */}
      {searchResult && !soldMessage && (
        <div className="mt-6">
          {searchResult.found && searchResult.stick ? (
            <div>
              <div className="bg-green-950/20 border border-green-900/60 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-green-300 text-sm font-medium">Stick found in inventory!</p>
                </div>
              </div>
              <StickCard
                stick={searchResult.stick}
                onSell={handleSell}
                showSellButton
                selling={selling}
              />
            </div>
          ) : (
            <div className="bg-amber-950/20 border border-amber-900/60 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="text-amber-300 text-sm font-medium">Not found in inventory</p>
                  <p className="text-amber-400/80 text-xs mt-1">
                    Serial number <span className="font-mono font-bold">{searchResult.serial}</span> was not found
                    in the Player Stick inventory. It may have already been sold or the serial number may be incorrect.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
