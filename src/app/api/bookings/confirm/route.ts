import { NextResponse, after } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { eventBus } from "@/core/events";
import "@/core/subscribers/booking";
import "@/core/subscribers/discord";
import "@/core/subscribers/whatsapp";
import "@/core/subscribers/guests";
import "@/core/subscribers/telegram";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import {
  isValidBookingDate,
  isValidTimeZone,
  normalizeBookingTime,
  parseBookingDateTime,
} from "@/lib/bookingTime";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";
import { resolveVenue } from "@/lib/venueResolver";

const MAX_OCCURRENCES = 31;
// Allow booking a slot that started a few minutes ago (walk-ins).
const PAST_GRACE_MS = 15 * 60 * 1000;

const venueSchema = z.object({
  id: z.string().min(1).max(200),
  placeId: z.string().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().max(500).nullable().optional(),
  category: z.string().max(50).optional(),
  latitude: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
});

const bodySchema = z.object({
  venue: venueSchema,
  date: z.string().optional(),
  dates: z.array(z.string()).max(MAX_OCCURRENCES).optional(),
  time: z.string().min(1),
  timeZone: z.string().optional(),
  customerEmail: z.string().trim().max(254).optional().nullable(),
  customerPhone: z.string().trim().max(32).optional().nullable(),
  projectBillingCode: z.string().trim().max(64).optional().nullable(),
});

function newConfirmationId(): string {
  return `WS-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export async function POST(req: Request) {
  try {
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
          error:
            "Rate limit exceeded. Too many bookings in a short time — please wait a moment.",
          retryAfter,
          retryAfterSeconds: retryAfter,
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

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return badRequest("Please check the booking details and try again.");
    }
    const body = parsed.data;

    const time = normalizeBookingTime(body.time);
    if (!time) return badRequest("Please choose a valid arrival time.");

    const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : "UTC";
    const dates = Array.from(
      new Set(body.dates?.length ? body.dates : body.date ? [body.date] : []),
    );
    if (dates.length === 0) return badRequest("Please choose a date.");
    if (!dates.every(isValidBookingDate)) {
      return badRequest("One of the selected dates is invalid.");
    }

    const earliest = Date.now() - PAST_GRACE_MS;
    for (const date of dates) {
      const startsAt = parseBookingDateTime(date, time, timeZone);
      if (!startsAt || startsAt.getTime() < earliest) {
        return badRequest("You can't book a time in the past.");
      }
    }

    let customerEmail = body.customerEmail?.trim() || "";
    if (!customerEmail) {
      const user = await currentUser();
      customerEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    }
    if (!z.string().email().safeParse(customerEmail).success) {
      return badRequest("Please enter a valid email for your confirmation.");
    }

    const venue = await resolveVenue(body.venue);
    if (!venue) {
      return badRequest("We couldn't find that venue. Please search again.");
    }

    const bookings = await prisma.$transaction(async (tx) => {
      const duplicates = await tx.booking.findMany({
        where: {
          userId,
          venueId: venue.id,
          date: { in: dates },
          time,
          status: { not: "CANCELLED" },
        },
        select: { date: true },
      });
      if (duplicates.length > 0) {
        throw new DuplicateBookingError(duplicates.map((d) => d.date));
      }

      const recurringGroupId =
        dates.length > 1 ? `rg_${randomBytes(8).toString("hex")}` : null;

      const created = [];
      for (const date of dates.sort()) {
        created.push(
          await tx.booking.create({
            data: {
              userId,
              venueId: venue.id,
              date,
              time,
              timeZone,
              customerEmail,
              customerPhone: body.customerPhone || null,
              projectBillingCode: body.projectBillingCode || null,
              confirmationId: newConfirmationId(),
              recurringGroupId,
              status: "CONFIRMED",
            },
          }),
        );
      }
      return created;
    });

    // Side effects (receipt email, chat integrations, webhooks) run after the response.
    const runBackground = async () => {
      for (const booking of bookings) {
        try {
          await eventBus.emit("booking:confirmed", {
            bookingId: booking.id,
            confirmationId: booking.confirmationId,
            venue: {
              id: venue.id,
              name: venue.name,
              category: venue.category,
              address: venue.address || undefined,
            },
            customerEmail,
            date: booking.date,
            time,
          });
        } catch (err) {
          console.error("[bookings/confirm] event handler failed:", err);
        }
      }
    };
    try {
      after(runBackground);
    } catch {
      void runBackground();
    }

    for (const booking of bookings) {
      emitWebhookEvent(userId, "BOOKING_CONFIRMED", {
        bookingId: booking.id,
        confirmationId: booking.confirmationId,
        venue: { id: venue.id, name: venue.name, address: venue.address },
        date: booking.date,
        time: booking.time,
        timeZone,
      });
    }

    return NextResponse.json({
      success: true,
      bookingId: bookings[0].id,
      bookingIds: bookings.map((b) => b.id),
      confirmationId: bookings[0].confirmationId,
      confirmationIds: bookings.map((b) => b.confirmationId),
      venueId: venue.id,
    });
  } catch (error) {
    if (error instanceof DuplicateBookingError) {
      return NextResponse.json(
        {
          success: false,
          error: `You already have a booking here at that time (${error.dates.join(", ")}).`,
        },
        { status: 409 },
      );
    }
    console.error("[bookings/confirm] failed:", error);
    return NextResponse.json(
      { success: false, error: "Booking failed. Please try again." },
      { status: 500 },
    );
  }
}

class DuplicateBookingError extends Error {
  constructor(public dates: string[]) {
    super("Duplicate booking");
  }
}
