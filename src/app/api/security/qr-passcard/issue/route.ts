import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { rateLimit } from "@/lib/rateLimit";
import { isValidTimeZone, parseBookingDateTime } from "@/lib/bookingTime";
import { issuePasscard } from "@/lib/security/serverOfflinePasscardIssuer";

const requestSchema = z.object({
  bookingId: z.string().trim().min(1).max(128),
});

/**
 * Re-issues the signed offline credential for an authenticated user's active
 * booking. The signing payload keeps the booking's original validity window:
 * renewal never extends access beyond the reserved slot.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return apiError("Unauthorized", 401, "UNAUTHORIZED");
    }

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError("A valid bookingId is required", 400, "VALIDATION_FAILED");
    }

    const allowed = await rateLimit(`offline-passcard-renewal:${userId}`, 5, 60 * 60 * 1000);
    if (!allowed) {
      return apiError("Too many passcard renewal attempts. Please try again later.", 429, "RATE_LIMITED");
    }

    const booking = await prisma.booking.findFirst({
      where: {
        id: parsed.data.bookingId,
        userId,
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
      },
      select: {
        id: true,
        userId: true,
        venueId: true,
        date: true,
        time: true,
        timeZone: true,
        duration: true,
        seatNumber: true,
      },
    });

    // Use the same not-found response for missing and non-owned bookings.
    if (!booking) {
      return apiError("Active booking not found", 404, "NOT_FOUND");
    }

    const timeZone = isValidTimeZone(booking.timeZone) ? booking.timeZone : "UTC";
    const startsAt = parseBookingDateTime(booking.date, booking.time, timeZone);
    if (!startsAt) {
      return apiError("Booking time could not be resolved", 400, "VALIDATION_FAILED");
    }

    const durationMinutes =
      typeof booking.duration === "number" && booking.duration > 0
        ? booking.duration
        : 60;
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    if (endsAt.getTime() <= Date.now()) {
      return apiError("This booking has expired; its passcard cannot be renewed.", 410, "CONFLICT");
    }

    const offlinePasscard = await issuePasscard({
      id: booking.id,
      userId: booking.userId,
      venueId: booking.venueId,
      startsAt,
      endsAt,
      durationMinutes,
      seatNumber: booking.seatNumber,
    });

    return NextResponse.json({ success: true, offlinePasscard });
  } catch (error) {
    console.error("[qr-passcard/issue] Failed to issue passcard:", error);
    return apiError("Offline passcard renewal is temporarily unavailable.", 503, "INTERNAL_ERROR");
  }
}
