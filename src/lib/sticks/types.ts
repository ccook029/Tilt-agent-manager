// ---------------------------------------------------------------------------
// Stick Inventory types — ported from the standalone tiltinventory app
// (src/types/stick.ts). One physical hockey stick = one row in the Zoho Sheet
// "Player Sticks" worksheet.
// ---------------------------------------------------------------------------
export interface HockeyStick {
  row_index: number;
  level: string;
  size: string;
  carbon: string;
  kick_point: string;
  hand: string;
  flex: string;
  curve: string;
  base_color: string;
  decal_color: string;
  serial_number: string;
  price: string;
}

export interface SearchResult {
  found: boolean;
  stick?: HockeyStick;
  message: string;
}

export interface SellResult {
  success: boolean;
  message: string;
  /** The stick that was sold (present on success) — used for signals. */
  stick?: HockeyStick;
}
