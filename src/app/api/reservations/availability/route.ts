import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureVenueLayout } from "@/lib/reservations/seed-layout";
import {
  isValidBookingDate,
  isValidTimeZone,
  normalizeBookingTime,
} from "@/lib/bookingTime";
import {
  conflictDateWindow,
  findConflictingBookings,
} from "@/lib/bookingOverlap";

export async function GET(request: NextRequest) {
  const venueId = request.nextUrl.searchParams.get("venueId");
  const date = request.nextUrl.searchParams.get("date");
  const rawTime = request.nextUrl.searchParams.get("time");
  const duration = Number(request.nextUrl.searchParams.get("duration") ?? 60);
  const rawTimeZone = request.nextUrl.searchParams.get("timeZone");

  if (!venueId || !date || !rawTime || !Number.isFinite(duration) || duration <= 0) {
    return NextResponse.json(
      { error: "venueId, date, time and positive duration are required" },
      { status: 400 },
    );
  }

  // Validate like the booking endpoints do. An unparseable time used to turn
  // into NaN, which made every comparison false and showed every seat as free.
  const time = normalizeBookingTime(rawTime);
  if (
    !isValidBookingDate(date) ||
    !time ||
    !Number.isInteger(duration) ||
    duration > 480
  ) {
    return NextResponse.json(
      { error: "Invalid date, time or duration" },
      { status: 400 },
    );
  }
  const timeZone = isValidTimeZone(rawTimeZone) ? rawTimeZone : "UTC";

  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: {
      id: true,
      name: true,
      address: true,
      category: true,
    },
  });

  if (!venue) {
    return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  }

  await ensureVenueLayout(venueId);

  const [seats, bookings] = await Promise.all([
    prisma.venueSeat.findMany({
      where: {
        venueId,
        isEnabled: true,
      },
      orderBy: { seatNumber: "asc" },
    }),
    prisma.booking.findMany({
      where: {
        venueId,
        // Include neighbouring dates: a booking that runs past midnight or was
        // made in another timezone is stored under a different date string.
        date: { in: conflictDateWindow(date) },
        status: {
          in: ["CONFIRMED", "PENDING"],
        },
        seatId: {
          not: null,
        },
      },
      select: {
        seatId: true,
        date: true,
        time: true,
        duration: true,
        timeZone: true,
      },
    }),
  ]);

  const unavailableSeatIds = new Set(
    findConflictingBookings({ date, time, timeZone, duration }, bookings)
      .map((booking) => booking.seatId)
      .filter((seatId): seatId is string => Boolean(seatId)),
  );

  return NextResponse.json({
    venue,
    date,
    time,
    timeZone,
    duration,
    seats: seats.map((seat) => ({
      ...seat,
      available: !unavailableSeatIds.has(seat.id),
    })),
  });
}
