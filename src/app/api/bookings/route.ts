import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { z } from "zod";
import { ensureUserExists } from "@/lib/auth";
import { isValidBookingDate } from "@/lib/bookingTime";

function generateConfirmationId() {
  return `WS-${randomBytes(3).toString("hex").toUpperCase()}`;
}

// Accepts a real calendar date in YYYY-MM-DD form, including cross-year dates
// (e.g. 2023-12-30 through 2024-01-02). `Date.parse` is deliberately avoided:
// it silently rolls impossible dates such as 2026-02-31 over into the next
// month, which would persist a booking that can never be parsed again.
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine(isValidBookingDate, "Invalid calendar date");

// 24-hour HH:mm with a real hour (00-23) and minute (00-59).
const bookingTimeString = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    "Time must be a valid 24-hour time in HH:mm format",
  );

const createBookingSchema = z.object({
  venueId: z.string().min(1, "venueId is required"),
  // Accept a single date or an array of dates for recurring/multi-date bookings.
  // A single date string is coerced to a one-element array for uniform handling.
  dates: z
    .union([isoDateString, z.array(isoDateString).min(1)])
    .transform((v) => (Array.isArray(v) ? v : [v])),
  time: bookingTimeString,
});

export async function GET(_request: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bookings = await prisma.booking.findMany({
      where: { userId: user.id },
      include: { venue: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: bookings });
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user || !user.primaryEmailAddress) {
      return NextResponse.json(
        { error: "Unauthorized or missing email" },
        { status: 401 },
      );
    }

    await ensureUserExists(user.id);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Invalid booking data" },
        { status: 400 },
      );
    }

    // Normalise: the legacy "date" field maps to the new "dates" array schema.
    const rawPayload = {
      ...body,
      dates: body.dates ?? body.date,
    };

    const parsed = createBookingSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid booking data",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { venueId, dates, time } = parsed.data;

    // Guest count is optional and stays null when the caller does not send one.
    // The bounds check lives here rather than in the Zod schema so the response
    // can carry a message that names both limits instead of a generic field error.
    let guestCount: number | undefined;
    if (rawPayload.guestCount !== undefined && rawPayload.guestCount !== null) {
      const requested = rawPayload.guestCount;

      if (
        typeof requested !== "number" ||
        !Number.isInteger(requested) ||
        requested < 1
      ) {
        return NextResponse.json(
          { error: "Guest count must be between 1 and venue capacity" },
          { status: 400 },
        );
      }

      const venue = await prisma.venue.findUnique({
        where: { id: venueId },
        select: { maxCapacity: true },
      });

      if (venue && requested > venue.maxCapacity) {
        return NextResponse.json(
          { error: "Guest count must be between 1 and venue capacity" },
          { status: 400 },
        );
      }

      guestCount = requested;
    }

    // Create one booking record per date. For a single date this is a single row;
    // for recurring bookings it is one row per occurrence.
    const createdBookings = await prisma.$transaction(
      dates.map((date) =>
        prisma.booking.create({
          data: {
            userId: user.id,
            venueId,
            date,
            time,
            customerEmail: user.primaryEmailAddress!.emailAddress,
            status: "CONFIRMED",
            confirmationId: generateConfirmationId(),
            ...(guestCount !== undefined && { guestCount }),
          },
          include: { venue: true },
        }),
      ),
    );

    return NextResponse.json({ success: true, data: createdBookings });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to create reservation" },
      { status: 500 },
    );
  }
}
