import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { bookSeatWithAdvisoryLock } from "@/lib/reservations/bookingEngine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { seatId, userId, startTime, endTime } = body;

    if (!seatId || !userId || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Missing required booking fields" },
        { status: 400 }
      );
    }

    const result = await bookSeatWithAdvisoryLock(
      prisma,
      seatId,
      userId,
      new Date(startTime),
      new Date(endTime)
    );

    if (!result.success) {
      if (result.isConflict) {
        return NextResponse.json(
          { error: result.error },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.reservation }, { status: 201 });
  } catch (err: any) {
    console.error("[Booking Error]:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}