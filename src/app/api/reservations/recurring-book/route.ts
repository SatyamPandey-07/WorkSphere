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

function generateDates(
  startDate: string,
  frequency: string,
  endDate: string | null,
  occurrences: number | null,
): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const limit = endDate ? new Date(endDate + "T00:00:00Z") : null;
  const maxOccurrences = occurrences ?? 52;

  const current = new Date(start);
  let count = 0;

  while (count < maxOccurrences) {
    if (limit && current > limit) break;

    const dateStr = current.toISOString().slice(0, 10);
    dates.push(dateStr);
    count++;

    switch (frequency) {
      case "daily":
        current.setDate(current.getDate() + 1);
        break;
      case "weekly":
        current.setDate(current.getDate() + 7);
        break;
      case "monthly":
        current.setMonth(current.getMonth() + 1);
        break;
      default:
        return dates;
    }
  }

  return dates;
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
  const frequency =
    typeof body.frequency === "string" ? body.frequency : "weekly";
  const endDate =
    typeof body.endDate === "string" && body.endDate ? body.endDate : null;
  const occurrences =
    typeof body.occurrences === "number" && body.occurrences > 0
      ? Math.min(body.occurrences, 52)
      : null;

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

  if (!endDate && !occurrences) {
    return NextResponse.json(
      { error: "Provide either an end date or a number of occurrences" },
      { status: 400 },
    );
  }

  if (!["daily", "weekly", "monthly"].includes(frequency)) {
    return NextResponse.json(
      { error: "Invalid frequency. Must be daily, weekly, or monthly" },
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

  const dates = generateDates(date, frequency, endDate, occurrences);

  if (dates.length === 0) {
    return NextResponse.json(
      { error: "No valid dates generated for the recurrence pattern" },
      { status: 400 },
    );
  }

  const recurringGroupId = `RG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const createdBookings: Array<{
    date: string;
    confirmationId: string;
    status: string;
  }> = [];
  const skippedDates: string[] = [];

  for (const bookingDate of dates) {
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(
        `SELECT id FROM "VenueSeat" WHERE id = $1 FOR UPDATE`,
        seatId,
      );

      const existingBookings = await tx.booking.findMany({
        where: {
          seatId,
          date: bookingDate,
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
        return { conflict: true as const };
      }

      const confirmationId = `WS-#${Math.floor(100000 + Math.random() * 900000)}`;

      const booking = await tx.booking.create({
        data: {
          userId,
          venueId,
          seatId,
          seatNumber: seat.seatNumber,
          duration,
          amenitiesNeeded,
          date: bookingDate,
          time,
          customerEmail:
            typeof body.customerEmail === "string"
              ? body.customerEmail
              : "guest@worksphere.local",
          customerPhone:
            typeof body.customerPhone === "string" ? body.customerPhone : null,
          confirmationId,
          status: "CONFIRMED",
        },
      });

      return { conflict: false as const, booking, confirmationId };
    });

    if (result.conflict) {
      skippedDates.push(bookingDate);
      continue;
    }

    const { booking, confirmationId } = result;

    createdBookings.push({
      date: bookingDate,
      confirmationId,
      status: "CONFIRMED",
    });

    if (guestEmails.length > 0) {
      try {
        await Promise.all(
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
        );
      } catch (err) {
        console.error(
          "[RecurringBookAPI] Failed to create guest records:",
          err,
        );
      }

      await eventBus.emit("booking:confirmed", {
        bookingId: booking.id,
        confirmationId,
        venue: {
          id: venueId,
          name: seat.venue.name,
          category: seat.venue.category || "workspace",
          address: seat.venue.address || undefined,
        },
        customerEmail: body.customerEmail || "guest@worksphere.local",
        date: bookingDate,
        time,
      });
    }

    publishVenueAvailability(venueId, {
      type: "seat_reserved",
      seatId,
      seatNumber: seat.seatNumber,
      date: bookingDate,
      time,
      duration,
    });
  }

  return NextResponse.json(
    {
      success: true,
      recurringGroupId,
      frequency,
      totalRequested: dates.length,
      booked: createdBookings.length,
      skipped: skippedDates.length,
      skippedDates,
      bookings: createdBookings,
      guestsAdded: guestEmails.length,
    },
    { status: 201 },
  );
}
