import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureVenueLayout } from "@/lib/reservations/seed-layout";

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function overlaps(
  bookingTime: string,
  bookingDuration: number,
  requestedTime: string,
  requestedDuration: number,
) {
  const bookingStart = toMinutes(bookingTime);
  const bookingEnd = bookingStart + bookingDuration;
  const requestedStart = toMinutes(requestedTime);
  const requestedEnd = requestedStart + requestedDuration;

  return bookingStart < requestedEnd && requestedStart < bookingEnd;
}

export async function GET(request: NextRequest) {
  const venueId = request.nextUrl.searchParams.get("venueId");
  const date = request.nextUrl.searchParams.get("date");
  const time = request.nextUrl.searchParams.get("time");
  const duration = Number(request.nextUrl.searchParams.get("duration") ?? 60);

  if (!venueId || !date || !time || !Number.isFinite(duration) || duration <= 0) {
    return NextResponse.json(
      { error: "venueId, date, time and positive duration are required" },
      { status: 400 },
    );
  }

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
        date,
        status: {
          in: ["CONFIRMED", "PENDING"],
        },
        seatId: {
          not: null,
        },
      },
      select: {
        seatId: true,
        time: true,
        duration: true,
      },
    }),
  ]);

  const unavailableSeatIds = new Set(
    bookings
      .filter((booking) =>
        overlaps(
          booking.time,
          booking.duration ?? 60,
          time,
          duration,
        ),
      )
      .map((booking) => booking.seatId)
      .filter((seatId): seatId is string => Boolean(seatId)),
  );

  return NextResponse.json({
    venue,
    date,
    time,
    duration,
    seats: seats.map((seat) => ({
      ...seat,
      available: !unavailableSeatIds.has(seat.id),
    })),
  });
}
