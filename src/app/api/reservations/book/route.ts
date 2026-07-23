import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { publishVenueAvailability } from "@/lib/reservations/event-bus";
import { eventBus } from "@/core/events";
import "@/core/subscribers/guests";

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

  let seatIds: string[] = [];
  if (Array.isArray(body.seatIds)) {
    seatIds = body.seatIds.filter((id: any) => typeof id === "string");
  } else if (typeof body.seatId === "string" && body.seatId) {
    seatIds = [body.seatId];
  }

  // Sort seat IDs deterministically before acquiring FOR UPDATE row locks
  // Enforce strict ascending locking order across concurrent requests
  const uniqueSeatIds = Array.from(new Set(seatIds)).sort();

  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  const duration = Number(body.duration);
  const amenitiesNeeded = Array.isArray(body.amenitiesNeeded)
    ? body.amenitiesNeeded
        .filter((item: unknown): item is string => typeof item === "string")
        .slice(0, 10)
    : [];
  const guestEmails: Array<{ email: string; name?: string }> = Array.isArray(
    body.guests,
  )
    ? body.guests
        .filter((g: any) => g && typeof g.email === "string")
        .map((g: any) => ({ email: g.email, name: g.name || undefined }))
        .slice(0, 20)
    : [];

  if (
    !venueId ||
    uniqueSeatIds.length === 0 ||
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

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Acquire FOR UPDATE locks on all seats in deterministic order
      for (const id of uniqueSeatIds) {
        await tx.$executeRawUnsafe(
          `SELECT id FROM "VenueSeat" WHERE id = $1 FOR UPDATE`,
          id,
        );
      }

      // 2. Fetch seats
      const seats = await tx.venueSeat.findMany({
        where: {
          id: { in: uniqueSeatIds },
          venueId,
          isEnabled: true,
        },
        include: {
          venue: true,
        },
      });

      if (seats.length !== uniqueSeatIds.length) {
        throw new Error("SEAT_NOT_FOUND");
      }

      // 3. Check existing bookings
      const existingBookings = await tx.booking.findMany({
        where: {
          seatId: { in: uniqueSeatIds },
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

      const conflict = existingBookings.some(
        (booking: { time: string; duration: number | null }) =>
          overlaps(booking.time, booking.duration ?? 60, time, duration),
      );

      if (conflict) {
        throw new Error("CONFLICT");
      }

      const confirmationId = `WS-#${Math.floor(100000 + Math.random() * 900000)}`;
      const createdBookings = [];

      for (const seat of seats) {
        const booking = await tx.booking.create({
          data: {
            userId,
            venueId,
            seatId: seat.id,
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
        createdBookings.push(booking);
      }

      return { createdBookings, confirmationId };
    });

    const { createdBookings, confirmationId } = result;

    // Create BookingGuest records if guests were provided
    if (guestEmails.length > 0) {
      try {
        await Promise.all(
          createdBookings.map((booking: any) =>
            Promise.all(
              guestEmails.map((guest) =>
                (prisma as any).bookingGuest.create({
                  data: {
                    bookingId: booking.id,
                    email: guest.email,
                    name: guest.name || null,
                    status: "PENDING",
                  },
                }),
              ),
            ),
          ),
        );
      } catch (err) {
        console.error("[BookAPI] Failed to create guest records:", err);
      }

      for (const booking of createdBookings) {
        // Emit booking:confirmed event so the guest subscriber picks them up
        await eventBus.emit("booking:confirmed", {
          bookingId: booking.id,
          confirmationId,
          venue: {
            id: venueId,
            name: booking.venue.name,
            category: booking.venue.category || "workspace",
            address: booking.venue.address || undefined,
          },
          customerEmail: body.customerEmail || "guest@worksphere.local",
          date,
          time,
        });
      }
    }

    for (const booking of createdBookings) {
      publishVenueAvailability(venueId, {
        type: "seat_reserved",
        seatId: booking.seatId,
        seatNumber: booking.seatNumber,
        date,
        time,
        duration,
      });
    }

    return NextResponse.json(
      {
        success: true,
        booking: createdBookings[0],
        bookings: createdBookings,
        confirmationId,
        guestsAdded: guestEmails.length,
      },
      { status: 201 },
    );
  } catch (err: any) {
    if (err.message === "SEAT_NOT_FOUND") {
      return NextResponse.json({ error: "Seat not found" }, { status: 404 });
    }
    if (err.message === "CONFLICT") {
      return NextResponse.json(
        { error: "That seat was just reserved. Choose another seat." },
        { status: 409 },
      );
    }
    console.error("[BookAPI] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
