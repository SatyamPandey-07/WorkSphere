import { NextRequest, NextResponse } from "next/server";
import { acquireDeskHold } from "@/lib/reservations/leaseManager";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { venueId, seatIds, userId } = body;

    if (
      !venueId ||
      !Array.isArray(seatIds) ||
      seatIds.length === 0 ||
      !userId
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid request body: venueId, seatIds array, and userId are required",
        },
        { status: 400 },
      );
    }

    const result = await acquireDeskHold({ venueId, seatIds, userId });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json(
      { success: true, holdIds: result.holdIds },
      { status: 201 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
