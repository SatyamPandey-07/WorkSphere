import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getDeskReservationTimer,
  getAllActiveDeskTimers,
} from "@/lib/reservations/deskReservationCountdown";
import { apiError } from "@/lib/apiResponse";

/**
 * GET /api/reservations/desk/timer
 * Query parameters:
 *  - venueId (required)
 *  - deskId (optional): when supplied, returns timer info for that specific desk.
 *                       when omitted, returns all active desk timers for the venue.
 */
export async function GET(req: NextRequest) {
  const venueId = req.nextUrl.searchParams.get("venueId");
  const deskId = req.nextUrl.searchParams.get("deskId");
  const { userId } = await auth();

  if (!venueId) {
    return apiError("venueId parameter is required", 400, "BAD_REQUEST");
  }

  if (deskId) {
    const timer = await getDeskReservationTimer(venueId, deskId, userId ?? undefined);
    return NextResponse.json(timer);
  }

  const timers = await getAllActiveDeskTimers(venueId);
  return NextResponse.json({
    venueId,
    activeReservationsCount: timers.length,
    timers,
  });
}
