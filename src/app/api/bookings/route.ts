import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { z } from "zod";
import { ensureUserExists } from "@/lib/auth";
import {
  isValidBookingDate,
  isValidTimeZone,
  parseBookingDateTime,
} from "@/lib/bookingTime";
import { apiError } from "@/lib/apiResponse";
import { apiHandler } from "@/lib/apiHandler";

function generateConfirmationId() {
  return `WS-${randomBytes(3).toString("hex").toUpperCase()}`;
}

// Accepts a real calendar date in YYYY-MM-DD form, including cross-year dates
// (e.g. 2023-12-30 through 2024-01-02).
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

const createBookingSchema = z
  .object({
    venueId: z.string().min(1, "venueId is required"),
    date: isoDateString.optional(),
    dates: z
      .union([isoDateString, z.array(isoDateString).min(1)])
      .optional(),
    time: bookingTimeString,
    timeZone: z.string().optional(),
    guestCount: z.number().int().min(1).optional().nullable(),
  })
  .transform((data) => ({
    venueId: data.venueId,
    dates: data.dates
      ? Array.isArray(data.dates)
        ? data.dates
        : [data.dates]
      : data.date
        ? [data.date]
        : [],
    time: data.time,
    timeZone: data.timeZone,
    guestCount: data.guestCount,
  }))
  .refine((data) => data.dates.length > 0, {
    message: "At least one valid date is required",
    path: ["dates"],
  });

type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const GET = apiHandler({
  authRequired: true,
  handler: async ({ userId }) => {
    const bookings = await prisma.booking.findMany({
      where: { userId: userId! },
      include: { venue: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: bookings });
  },
});

export const POST = apiHandler<CreateBookingInput>({
  authRequired: true,
  schema: createBookingSchema as any,
  handler: async ({ body }) => {
    const { venueId, dates, time, timeZone, guestCount: requestedCount } = body;
    const bookingTimeZone = isValidTimeZone(timeZone) ? timeZone : "UTC";

    for (const date of dates) {
      const startsAt = parseBookingDateTime(date, time, bookingTimeZone);
      if (!startsAt) {
        return apiError(
          "Booking time does not exist on this date in the selected time zone",
          400,
          "VALIDATION_FAILED",
        );
      }
      if (startsAt.getTime() < Date.now()) {
        return apiError(
          "You can't book a time in the past.",
          400,
          "VALIDATION_FAILED",
        );
      }
    }

    const user = await currentUser();
    if (!user || !user.primaryEmailAddress) {
      return apiError("Unauthorized or missing email", 401, "UNAUTHORIZED");
    }

    await ensureUserExists(user.id);

    const existingVenue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true, maxCapacity: true },
    });
    if (!existingVenue) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    let guestCount: number | undefined;
    if (requestedCount !== undefined && requestedCount !== null) {
      if (
        typeof requestedCount !== "number" ||
        !Number.isInteger(requestedCount) ||
        requestedCount < 1 ||
        requestedCount > existingVenue.maxCapacity
      ) {
        return apiError(
          "Guest count must be between 1 and venue capacity",
          400,
          "VALIDATION_FAILED",
        );
      }
      guestCount = requestedCount;
    }

    const createdBookings = await prisma.$transaction(
      dates.map((date) =>
        prisma.booking.create({
          data: {
            userId: user.id,
            venueId,
            date,
            time,
            timeZone: bookingTimeZone,
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
  },
});
