import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse, after } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { publishVenueAvailability } from "@/lib/reservations/event-bus";
import { eventBus } from "@/core/events";
import "@/core/subscribers/booking";
import "@/core/subscribers/guests";
import { rateLimit } from "@/lib/rateLimit";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";
import { conflictDateWindow, hasBookingConflict } from "@/lib/bookingOverlap";
import { releaseSeatWebLock } from "@/lib/locks/seatHoldLock";
import { validateRecurringReservation } from "@/lib/booking/recurringReservationValidation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await rateLimit(`book:${userId}`, 5))) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded. Please wait before making more bookings.",
      },
      { status: 429 },
    );
  }

  await ensureUserExists(userId);

  const body = await request.json().catch(() => ({}));

  const venueId = typeof body.venueId === "string" ? body.venueId : "";
  const seatId = typeof body.seatId === "string" ? body.seatId : "";
  const validation = validateRecurringReservation(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        error: "Invalid recurring reservation details",
        fieldErrors: validation.fieldErrors,
      },
      { status: 400 },
    );
  }
  const { time, timeZone, duration, frequency, dates } = validation.data;

  if (!venueId || !seatId) {
    const fieldErrors: Record<string, string> = {};
    if (!venueId) fieldErrors.venueId = "venueId is required.";
    if (!seatId) fieldErrors.seatId = "seatId is required.";
    return NextResponse.json(
      { error: "Invalid recurring reservation details", fieldErrors },
      { status: 400 },
    );
  }

  const amenitiesNeeded: string[] = Array.isArray(body.amenitiesNeeded)
    ? body.amenitiesNeeded
        .filter((item: unknown): item is string => typeof item === "string")
        .map((item: string) => item.slice(0, 50))
        .slice(0, 10)
    : [];
  const guestEmails: Array<{ email: string; name?: string }> = Array.isArray(
    body.guests,
  )
    ? body.guests
        .filter(
          (g: any) =>
            g && typeof g.email === "string" && EMAIL_RE.test(g.email),
        )
        .map((g: any) => ({
          email: g.email.trim().toLowerCase(),
          name: g.name || undefined,
        }))
        .slice(0, 20)
    : [];
  let customerEmail =
    typeof body.customerEmail === "string" ? body.customerEmail.trim() : "";
  if (!EMAIL_RE.test(customerEmail)) {
    const user = await currentUser();
    customerEmail = user?.primaryEmailAddress?.emailAddress ?? "";
  }
  if (!EMAIL_RE.test(customerEmail)) {
    return NextResponse.json(
      {
        error: "Add an email address to your account to receive confirmations.",
      },
      { status: 400 },
    );
  }

  const seat = await prisma.venueSeat.findFirst({
    where: { id: seatId, venueId, isEnabled: true },
    include: { venue: true },
  });
  if (!seat) {
    return NextResponse.json({ error: "Seat not found" }, { status: 404 });
  }

  const recurringGroupId = `rg_${randomBytes(8).toString("hex")}`;
  const created: { id: string; date: string; confirmationId: string }[] = [];
  const skippedDates: string[] = [];

  for (const bookingDate of dates) {
    const booking = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VenueSeat" WHERE id = ${seatId} FOR UPDATE`;

      const existing = await tx.booking.findMany({
        where: {
          seatId,
          // A conflicting booking can be stored under a neighbouring date
          // (it runs past midnight, or was made in another timezone).
          date: { in: conflictDateWindow(bookingDate) },
          status: { in: ["CONFIRMED", "PENDING"] },
        },
        select: { date: true, time: true, duration: true, timeZone: true },
      });
      if (
        hasBookingConflict(
          { date: bookingDate, time, timeZone, duration },
          existing,
        )
      ) {
        return null;
      }

      return tx.booking.create({
        data: {
          userId,
          venueId,
          seatId,
          seatNumber: seat.seatNumber,
          duration,
          amenitiesNeeded,
          date: bookingDate,
          time,
          timeZone,
          customerEmail,
          customerPhone:
            typeof body.customerPhone === "string"
              ? body.customerPhone.slice(0, 32)
              : null,
          confirmationId: `WS-${randomBytes(4).toString("hex").toUpperCase()}`,
          recurringGroupId,
          frequency,
          status: "CONFIRMED",
        },
      });
    });

    if (!booking) {
      skippedDates.push(bookingDate);
      continue;
    }
    created.push({
      id: booking.id,
      date: bookingDate,
      confirmationId: booking.confirmationId,
    });

    publishVenueAvailability(venueId, {
      type: "seat_reserved",
      seatId,
      seatNumber: seat.seatNumber,
      date: bookingDate,
      time,
      duration,
    });
    emitWebhookEvent(userId, "BOOKING_CONFIRMED", {
      bookingId: booking.id,
      confirmationId: booking.confirmationId,
      recurringGroupId,
      venue: {
        id: venueId,
        name: seat.venue.name,
        address: seat.venue.address,
      },
      seatNumber: seat.seatNumber,
      date: bookingDate,
      time,
      timeZone,
      durationMinutes: duration,
    });
  }

  // Explicitly release distributed seat hold lock for the booked seat
  releaseSeatWebLock(venueId, seatId, userId).catch(() => {});

  if (guestEmails.length > 0 && created.length > 0) {
    await prisma.bookingGuest
      .createMany({
        data: created.flatMap((b) =>
          guestEmails.map((guest) => ({
            bookingId: b.id,
            email: guest.email,
            name: guest.name || null,
            status: "PENDING" as const,
          })),
        ),
        skipDuplicates: true,
      })
      .catch((err) =>
        console.error("[RecurringBookAPI] guest records failed:", err),
      );
  }

  // One confirmation for the series (receipt of the first occurrence).
  if (created.length > 0) {
    const first = created[0];
    const notify = () =>
      eventBus
        .emit("booking:confirmed", {
          bookingId: first.id,
          confirmationId: first.confirmationId,
          venue: {
            id: venueId,
            name: seat.venue.name,
            category: seat.venue.category || "workspace",
            address: seat.venue.address || undefined,
          },
          customerEmail,
          date: first.date,
          time,
        })
        .catch((err) =>
          console.error("[RecurringBookAPI] notify failed:", err),
        );
    try {
      after(notify);
    } catch {
      void notify();
    }
  }

  return NextResponse.json(
    {
      success: true,
      recurringGroupId,
      frequency,
      totalRequested: dates.length,
      booked: created.length,
      skipped: skippedDates.length,
      skippedDates,
      bookings: created.map(({ date, confirmationId }) => ({
        date,
        confirmationId,
        status: "CONFIRMED",
      })),
      guestsAdded: guestEmails.length,
    },
    { status: 201 },
  );
}
