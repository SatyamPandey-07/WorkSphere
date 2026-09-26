import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { z } from "zod";

function generateConfirmationId() {
  return `WS-${randomBytes(3).toString("hex").toUpperCase()}`;
}

// Accepts any valid ISO 8601 date — YYYY-MM-DD — including cross-year dates
// (e.g. 2023-12-30 through 2024-01-02) that simple month-based regex would reject.
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine((val) => !isNaN(Date.parse(val)), "Invalid calendar date");

const createBookingSchema = z.object({
  venueId: z.string().min(1, "venueId is required"),
  // Accept a single date or an array of dates for recurring/multi-date bookings.
  // A single date string is coerced to a one-element array for uniform handling.
  dates: z
    .union([isoDateString, z.array(isoDateString).min(1)])
    .transform((v) => (Array.isArray(v) ? v : [v])),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:mm format"),
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

    const body = await request.json();

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
    const confirmationId = generateConfirmationId();

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
            confirmationId,
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
