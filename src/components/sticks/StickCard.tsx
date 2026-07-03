"use client";

// ---------------------------------------------------------------------------
// StickCard — one physical stick, spec grid + optional "Mark as SOLD" button.
// Ported from tiltinventory's components/StickCard.tsx and restyled from the
// standalone app's light theme to the hub's dark theme.
// ---------------------------------------------------------------------------
import { HockeyStick } from "@/lib/sticks/types";

interface StickCardProps {
  stick: HockeyStick;
  onSell?: (serialNumber: string) => void;
  showSellButton?: boolean;
  selling?: boolean;
}

export default function StickCard({ stick, onSell, showSellButton = false, selling = false }: StickCardProps) {
  return (
    <div className="bg-[#101010] rounded-xl border border-gray-800 overflow-hidden hover:border-gray-700 transition-colors">
      <div className="bg-black border-b border-gray-800 text-white px-5 py-3 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold">{stick.level}</h3>
          <p className="text-xs text-gray-500 font-mono">{stick.serial_number}</p>
        </div>
        <div className="flex items-center gap-2">
          {stick.price && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#00d6ff] text-black">
              ${stick.price}
            </span>
          )}
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
            stick.hand === "Left"
              ? "border-purple-800 bg-purple-950/40 text-purple-300"
              : "border-emerald-800 bg-emerald-950/40 text-emerald-300"
          }`}>
            {stick.hand}
          </span>
        </div>
      </div>

      <div className="p-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <span className="text-gray-500">Size</span>
            <p className="font-medium text-gray-200">{stick.size}&quot;</p>
          </div>
          <div>
            <span className="text-gray-500">Flex</span>
            <p className="font-medium text-gray-200">{stick.flex}</p>
          </div>
          <div>
            <span className="text-gray-500">Carbon</span>
            <p className="font-medium text-gray-200">{stick.carbon}</p>
          </div>
          <div>
            <span className="text-gray-500">Curve</span>
            <p className="font-medium text-gray-200">{stick.curve}</p>
          </div>
          <div>
            <span className="text-gray-500">Kick Point</span>
            <p className="font-medium text-gray-200">{stick.kick_point}</p>
          </div>
          <div>
            <span className="text-gray-500">Colors</span>
            <p className="font-medium text-gray-200">{stick.base_color} / {stick.decal_color}</p>
          </div>
        </div>

        {showSellButton && onSell && (
          <button
            onClick={() => onSell(stick.serial_number)}
            disabled={selling}
            className="mt-4 w-full bg-[#00d6ff] text-black py-2.5 px-4 rounded-lg font-semibold
              hover:bg-[#33e0ff] focus:outline-none focus:ring-2 focus:ring-[#00d6ff]/60 focus:ring-offset-2 focus:ring-offset-[#101010]
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {selling ? "Processing..." : "Mark as SOLD"}
          </button>
        )}
      </div>
    </div>
  );
}
