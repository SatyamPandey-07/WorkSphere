import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { publishVenueAvailability } from "@/lib/reservations/event-bus";

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

export async function POST(request: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureUserExists(userId);

  const body = await request.json();

  const venueId = typeof body.venueId === "string" ? body.venueId : "";
  const seatId = typeof body.seatId === "string" ? body.seatId : "";
  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  const duration = Number(body.duration);
  const amenitiesNeeded = Array.isArray(body.amenitiesNeeded)
    ? body.amenitiesNeeded.filter((item: unknown): item is string => typeof item === "string").slice(0, 10)
    : [];

  if (
    !venueId ||
    !seatId ||
    !date ||
    !/^\d{2}:\d{2}$/.test(time) ||
    !Number.isInteger(duration) ||
    duration < 30 ||
    duration > 480
  ) {
    return NextResponse.json(
      { error: "Invalid reservation details" },
      { status: 400 },
    );
  }

  const seat = await prisma.venueSeat.findFirst({
    where: {
      id: seatId,
      venueId,
      isEnabled: true,
    },
    include: {
      venue: true,
    },
  });

  if (!seat) {
    return NextResponse.json({ error: "Seat not found" }, { status: 404 });
  }

  const existingBookings = await prisma.booking.findMany({
    where: {
      seatId,
      date,
      status: {
        in: ["CONFIRMED", "PENDING"],
      },
    },
    select: {
      time: true,
      duration: true,
    },
  });

  const conflict = existingBookings.some((booking) =>
    overlaps(
      booking.time,
      booking.duration ?? 60,
      time,
      duration,
    ),
  );

  if (conflict) {
    return NextResponse.json(
      { error: "That seat was just reserved. Choose another seat." },
      { status: 409 },
    );
  }

  const confirmationId = `WS-#${Math.floor(100000 + Math.random() * 900000)}`;

  const booking = await prisma.booking.create({
    data: {
      userId,
      venueId,
      seatId,
      seatNumber: seat.seatNumber,
      duration,
      amenitiesNeeded,
      date,
      time,
      customerEmail:
        typeof body.customerEmail === "string"
          ? body.customerEmail
          : "guest@worksphere.local",
      customerPhone:
        typeof body.customerPhone === "string"
          ? body.customerPhone
          : null,
      confirmationId,
      status: "CONFIRMED",
    },
    include: {
      venue: {
        select: {
          name: true,
          address: true,
        },
      },
      seat: true,
    },
  });

  publishVenueAvailability(venueId, {
    type: "seat_reserved",
    seatId,
    seatNumber: seat.seatNumber,
    date,
    time,
    duration,
  });

  return NextResponse.json(
    {
      success: true,
      booking,
      confirmationId,
    },
    { status: 201 },
  );
}
