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
import {
  isValidBookingDate,
  isValidTimeZone,
  normalizeBookingTime,
  parseBookingDateTime,
} from "@/lib/bookingTime";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";
import { conflictDateWindow, hasBookingConflict } from "@/lib/bookingOverlap";

const MAX_OCCURRENCES = 52;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateDates(
  startDate: string,
  frequency: string,
  endDate: string | null,
  occurrences: number | null,
): string[] {
  const dates: string[] = [];
  const [y, m, d] = startDate.split("-").map(Number);
  const limit = endDate ?? null;
  const maxOccurrences = Math.min(
    occurrences ?? MAX_OCCURRENCES,
    MAX_OCCURRENCES,
  );

  for (let i = 0; dates.length < maxOccurrences; i++) {
    const next =
      frequency === "daily"
        ? new Date(Date.UTC(y, m - 1, d + i))
        : frequency === "weekly"
          ? new Date(Date.UTC(y, m - 1, d + 7 * i))
          : frequency === "monthly"
            ? new Date(Date.UTC(y, m - 1 + i, d))
            : null;
    if (!next) break;
    const dateStr = next.toISOString().slice(0, 10);
    if (limit && dateStr > limit) break;
    dates.push(dateStr);
  }
  return dates;
}

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
  const date = typeof body.date === "string" ? body.date : "";
  const time = normalizeBookingTime(
    typeof body.time === "string" ? body.time : "",
  );
  const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : "UTC";
  const duration = Number(body.duration);
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
  const frequency =
    typeof body.frequency === "string" ? body.frequency : "weekly";
  const endDate =
    typeof body.endDate === "string" && isValidBookingDate(body.endDate)
      ? body.endDate
      : null;
  const occurrences =
    typeof body.occurrences === "number" && body.occurrences > 0
      ? Math.min(Math.floor(body.occurrences), MAX_OCCURRENCES)
      : null;

  if (
    !venueId ||
    !seatId ||
    !isValidBookingDate(date) ||
    !time ||
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

  const firstStart = parseBookingDateTime(date, time, timeZone);
  if (!firstStart || firstStart.getTime() < Date.now() - 15 * 60 * 1000) {
    return NextResponse.json(
      { error: "You can't book a time in the past." },
      { status: 400 },
    );
  }

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

  const dates = generateDates(date, frequency, endDate, occurrences);
  if (dates.length === 0) {
    return NextResponse.json(
      { error: "No valid dates generated for the recurrence pattern" },
      { status: 400 },
    );
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
