// ---------------------------------------------------------------------------
// GET /api/sticks/search?serial=H2304-02571 — find one stick by serial number.
// Ported from tiltinventory's /api/search.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  searchBySerialNumber,
  sticksConfigured,
  NOT_CONFIGURED_MESSAGE,
} from "@/lib/sticks/zoho";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const serial = searchParams.get("serial");

  if (!serial) {
    return NextResponse.json(
      { found: false, message: "Serial number is required" },
      { status: 400 }
    );
  }

  if (!sticksConfigured()) {
    return NextResponse.json({
      found: false,
      configured: false,
      message: NOT_CONFIGURED_MESSAGE,
    });
  }

  try {
    const stick = await searchBySerialNumber(serial);

    if (stick) {
      return NextResponse.json({
        found: true,
        stick,
        message: `Found stick: ${stick.level} - ${stick.serial_number}`,
      });
    } else {
      return NextResponse.json({
        found: false,
        message: `No stick found with serial number: ${serial}`,
      });
    }
  } catch (error) {
    console.error("Stick search error:", error);
    return NextResponse.json(
      {
        found: false,
        message: error instanceof Error ? error.message : "Search failed",
      },
      { status: 500 }
    );
  }
}
