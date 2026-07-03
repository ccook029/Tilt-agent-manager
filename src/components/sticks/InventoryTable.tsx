"use client";

// ---------------------------------------------------------------------------
// InventoryTable — search + hand/level filters over the stick grid.
// Ported from tiltinventory's components/InventoryTable.tsx and restyled from
// the standalone app's light theme to the hub's dark theme.
// ---------------------------------------------------------------------------
import { useState, useMemo } from "react";
import { HockeyStick } from "@/lib/sticks/types";
import StickCard from "./StickCard";

interface InventoryTableProps {
  sticks: HockeyStick[];
  loading: boolean;
  error: string | null;
  onSell?: (serialNumber: string) => void;
  sellingSerial?: string | null;
}

export default function InventoryTable({
  sticks,
  loading,
  error,
  onSell,
  sellingSerial,
}: InventoryTableProps) {
  const [search, setSearch] = useState("");
  const [filterHand, setFilterHand] = useState<string>("All");
  const [filterLevel, setFilterLevel] = useState<string>("All");

  const levels = useMemo(() => {
    const unique = [...new Set(sticks.map((s) => s.level))].sort();
    return ["All", ...unique];
  }, [sticks]);

  const filtered = useMemo(() => {
    return sticks.filter((stick) => {
      const matchesSearch =
        !search ||
        stick.serial_number.toLowerCase().includes(search.toLowerCase()) ||
        stick.level.toLowerCase().includes(search.toLowerCase()) ||
        stick.curve.toLowerCase().includes(search.toLowerCase()) ||
        stick.base_color.toLowerCase().includes(search.toLowerCase()) ||
        stick.decal_color.toLowerCase().includes(search.toLowerCase());

      const matchesHand = filterHand === "All" || stick.hand === filterHand;
      const matchesLevel = filterLevel === "All" || stick.level === filterLevel;

      return matchesSearch && matchesHand && matchesLevel;
    });
  }, [sticks, search, filterHand, filterLevel]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <svg className="animate-spin h-10 w-10 text-[#00d6ff] mx-auto mb-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-gray-500">Loading inventory...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-950/20 border border-red-900/60 rounded-xl p-6 text-center">
        <p className="text-red-300 font-medium">Failed to load inventory</p>
        <p className="text-red-400/80 text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Search & Filters */}
      <div className="bg-[#101010] rounded-xl border border-gray-800 p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search serial, model, curve, color..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-4 py-2.5 bg-black/40 border border-gray-800 rounded-lg text-sm text-gray-200 placeholder:text-gray-600
              focus:ring-2 focus:ring-[#00d6ff]/50 focus:border-[#00d6ff]/60 focus:outline-none"
          />
          <select
            value={filterHand}
            onChange={(e) => setFilterHand(e.target.value)}
            className="px-4 py-2.5 bg-black/40 border border-gray-800 rounded-lg text-sm text-gray-200
              focus:ring-2 focus:ring-[#00d6ff]/50 focus:border-[#00d6ff]/60 focus:outline-none"
          >
            <option value="All">All Hands</option>
            <option value="Left">Left</option>
            <option value="Right">Right</option>
          </select>
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="px-4 py-2.5 bg-black/40 border border-gray-800 rounded-lg text-sm text-gray-200
              focus:ring-2 focus:ring-[#00d6ff]/50 focus:border-[#00d6ff]/60 focus:outline-none"
          >
            {levels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Showing {filtered.length} of {sticks.length} sticks
        </p>
      </div>

      {/* Stick Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg font-medium">No sticks found</p>
          <p className="text-sm mt-1">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((stick) => (
            <StickCard
              key={stick.serial_number}
              stick={stick}
              onSell={onSell}
              showSellButton={!!onSell}
              selling={sellingSerial === stick.serial_number}
            />
          ))}
        </div>
      )}
    </div>
  );
}
