import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse, after } from "next/server";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { publishVenueAvailability } from "@/lib/reservations/event-bus";
import { eventBus } from "@/core/events";
import "@/core/subscribers/booking";
import "@/core/subscribers/guests";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import {
  isValidBookingDate,
  isValidTimeZone,
  normalizeBookingTime,
  parseBookingDateTime,
} from "@/lib/bookingTime";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";
import { conflictDateWindow, hasBookingConflict } from "@/lib/bookingOverlap";
import { releaseSeatWebLock } from "@/lib/locks/seatHoldLock";

const PAST_GRACE_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newConfirmationId(): string {
  return `WS-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const identifier = `book:${userId}`;
  if (!(await rateLimit(identifier, 5))) {
    const info = await getRateLimitInfo(identifier, 5);
    const retryAfter = info?.resetTime
      ? Math.ceil((info.resetTime - Date.now()) / 1000)
      : 60;
    return NextResponse.json(
      {
        error: "Rate limit exceeded. Please wait before making more bookings.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Reset": String(
            Math.ceil(Date.now() / 1000) + retryAfter,
          ),
        },
      },
    );
  }

  await ensureUserExists(userId);

  const body = await request.json().catch(() => ({}));
  const venueId = typeof body.venueId === "string" ? body.venueId : "";

  let seatIds: string[] = [];
  if (Array.isArray(body.seatIds)) {
    seatIds = body.seatIds.filter((id: unknown) => typeof id === "string");
  } else if (typeof body.seatId === "string" && body.seatId) {
    seatIds = [body.seatId];
  }
  // Sorted so concurrent transactions lock rows in the same order (no deadlocks).
  const uniqueSeatIds = Array.from(new Set(seatIds))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 20);

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

  if (
    !venueId ||
    uniqueSeatIds.length === 0 ||
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

  const startsAt = parseBookingDateTime(date, time, timeZone);
  if (!startsAt || startsAt.getTime() < Date.now() - PAST_GRACE_MS) {
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

  const MAX_RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    try {
      const createdBookings = await prisma.$transaction(
        async (tx) => {
          // Row-lock the requested seats for the rest of the transaction.
          await tx.$queryRaw`SELECT id FROM "VenueSeat" WHERE id IN (${Prisma.join(uniqueSeatIds)}) FOR UPDATE`;

          const seats = await tx.venueSeat.findMany({
            where: { id: { in: uniqueSeatIds }, venueId, isEnabled: true },
            orderBy: { id: "asc" },
          });
          if (seats.length !== uniqueSeatIds.length) {
            throw new Error("SEAT_NOT_FOUND");
          }

          const existing = await tx.booking.findMany({
            where: {
              seatId: { in: uniqueSeatIds },
              // A conflicting booking can be stored under a neighbouring date
              // (it runs past midnight, or was made in another timezone).
              date: { in: conflictDateWindow(date) },
              status: { in: ["CONFIRMED", "PENDING"] },
            },
            select: { date: true, time: true, duration: true, timeZone: true },
          });
          if (hasBookingConflict({ date, time, timeZone, duration }, existing)) {
            throw new Error("CONFLICT");
          }

          const created = [];
          for (const seat of seats) {
            created.push(
              await tx.booking.create({
                data: {
                  userId,
                  venueId,
                  seatId: seat.id,
                  seatNumber: seat.seatNumber,
                  duration,
                  amenitiesNeeded,
                  date,
                  time,
                  timeZone,
                  customerEmail,
                  customerPhone:
                    typeof body.customerPhone === "string"
                      ? body.customerPhone.slice(0, 32)
                      : null,
                  confirmationId: newConfirmationId(),
                  status: "CONFIRMED",
                },
                include: {
                  venue: {
                    select: { name: true, address: true, category: true },
                  },
                  seat: true,
                },
              }),
            );
          }
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (guestEmails.length > 0) {
        await prisma.bookingGuest
          .createMany({
            data: createdBookings.flatMap((booking) =>
              guestEmails.map((guest) => ({
                bookingId: booking.id,
                email: guest.email,
                name: guest.name || null,
                status: "PENDING" as const,
              })),
            ),
            skipDuplicates: true,
          })
          .catch((err) =>
            console.error("[BookAPI] Failed to create guest records:", err),
          );
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
        emitWebhookEvent(userId, "BOOKING_CONFIRMED", {
          bookingId: booking.id,
          confirmationId: booking.confirmationId,
          venue: {
            id: venueId,
            name: booking.venue.name,
            address: booking.venue.address,
          },
          seatNumber: booking.seatNumber,
          date,
          time,
          timeZone,
          durationMinutes: duration,
        });
      }

      // Explicitly release any distributed seat hold locks for confirmed seats
      for (const sId of uniqueSeatIds) {
        releaseSeatWebLock(venueId, sId, userId).catch(() => {});
      }

      const notify = async () => {
        for (const booking of createdBookings) {
          try {
            await eventBus.emit("booking:confirmed", {
              bookingId: booking.id,
              confirmationId: booking.confirmationId,
              venue: {
                id: venueId,
                name: booking.venue.name,
                category: booking.venue.category || "workspace",
                address: booking.venue.address || undefined,
              },
              customerEmail,
              date,
              time,
            });
          } catch (err) {
            console.error("[BookAPI] confirmation handlers failed:", err);
          }
        }
      };
      try {
        after(notify);
      } catch {
        void notify();
      }

      return NextResponse.json(
        {
          success: true,
          booking: createdBookings[0],
          bookings: createdBookings,
          confirmationId: createdBookings[0].confirmationId,
          confirmationIds: createdBookings.map((b) => b.confirmationId),
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

      const isTransient =
        err.code === "P2028" ||
        err.code === "P2034" ||
        err.code === "40001" ||
        err.code === "40P01" ||
        err.meta?.code === "40001" ||
        err.meta?.code === "40P01" ||
        err.message?.includes("Timed out fetching a new connection") ||
        err.message?.includes("deadlock") ||
        err.message?.includes("serialization") ||
        err.message?.includes("40P01") ||
        err.message?.includes("40001");

      if (isTransient && attempt < MAX_RETRIES) {
        const backoff = Math.min(
          2 ** (attempt + 1) * 100 + Math.random() * 50,
          2000,
        );
        await new Promise((res) => setTimeout(res, backoff));
        continue;
      }

      console.error("[BookAPI] Error:", err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  }
}
