// ---------------------------------------------------------------------------
// GET /api/sticks/inventory — list every stick on the "Player Sticks" sheet.
// Ported from tiltinventory's /api/inventory (renamed: the hub already has
// /api/inventory/* for the Stockton agent).
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import {
  getInventory,
  sticksConfigured,
  NOT_CONFIGURED_MESSAGE,
} from "@/lib/sticks/zoho";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!sticksConfigured()) {
    return NextResponse.json({
      success: false,
      configured: false,
      message: NOT_CONFIGURED_MESSAGE,
    });
  }

  try {
    const sticks = await getInventory();
    return NextResponse.json({ success: true, sticks });
  } catch (error) {
    console.error("Stick inventory fetch error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch inventory",
      },
      { status: 500 }
    );
  }
}
