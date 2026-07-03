// ---------------------------------------------------------------------------
// POST /api/sticks/sell — move a stick from "Player Sticks" to "Sold Stick".
// Ported from tiltinventory's /api/sell; on success it also drops a one-line
// signal into the cross-tool inbox so the sale shows up in the Morning Brief.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  markAsSold,
  sticksConfigured,
  NOT_CONFIGURED_MESSAGE,
} from "@/lib/sticks/zoho";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!sticksConfigured()) {
    return NextResponse.json({
      success: false,
      configured: false,
      message: NOT_CONFIGURED_MESSAGE,
    });
  }

  try {
    const body = await request.json();
    const { serial_number } = body;

    if (!serial_number) {
      return NextResponse.json(
        { success: false, message: "Serial number is required" },
        { status: 400 }
      );
    }

    const result = await markAsSold(serial_number);

    if (result.success) {
      const stick = result.stick;
      const detail = [
        stick?.level && `Level: ${stick.level}`,
        stick?.flex && `Flex: ${stick.flex}`,
        stick?.hand && `Hand: ${stick.hand}`,
      ]
        .filter(Boolean)
        .join(" · ");
      await postSignal({
        source: "stick-inventory",
        headline: `Stick sold: ${serial_number}${stick?.price ? ` — $${stick.price}` : ""}`,
        ...(detail ? { detail } : {}),
      }).catch(() => {});
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Stick sell error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to mark as sold",
      },
      { status: 500 }
    );
  }
}
