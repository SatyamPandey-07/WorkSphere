import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  cancellationWindowHoursRemaining,
  getBookingCancellationEligibility,
  isValidBookingDate,
  isValidTimeZone,
  normalizeBookingTime,
  parseBookingDateTime,
  conflictDateWindow,
  hasBookingConflict,
} from "@/lib/booking";
import { prisma } from "@/lib/prisma";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";
import { notifyNextInWaitlist } from "@/lib/waitlist";
import { publishVenueAvailability } from "@/lib/reservations/event-bus";

type RouteContext = {
  params: Promise<{
    bookingId: string;
  }>;
};

const PAST_GRACE_MS = 15 * 60 * 1000;

/**
 * PATCH /api/bookings/[bookingId]
 *
 * Reschedules or extends the duration of an active booking.
 * Verifies desk availability without releasing the current slot until the conflict check passes.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 },
      );
    }

    const { bookingId } = await context.params;

    if (!bookingId) {
      return NextResponse.json(
        {
          success: false,
          error: "Booking ID is required.",
        },
        { status: 400 },
      );
    }

    const booking = await prisma.booking.findFirst({
      where: {
        OR: [{ id: bookingId }, { confirmationId: bookingId }],
        userId,
      },
      include: {
        venue: {
          select: { id: true, name: true, address: true, category: true },
        },
        seat: true,
      },
    });

    if (!booking) {
      return NextResponse.json(
        {
          success: false,
          error: "Booking not found.",
        },
        { status: 404 },
      );
    }

    if (booking.status === "CANCELLED") {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot reschedule a cancelled booking.",
        },
        { status: 400 },
      );
    }

    if (booking.status === "COMPLETED") {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot reschedule a completed booking.",
        },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const targetDate = typeof body.date === "string" && body.date.trim() ? body.date.trim() : booking.date;
    const rawTime = typeof body.time === "string" && body.time.trim() ? body.time.trim() : booking.time;
    const targetTime = normalizeBookingTime(rawTime);
    const targetDuration = body.duration !== undefined ? Number(body.duration) : (booking.duration ?? 60);
    const targetTimeZone = isValidTimeZone(body.timeZone)
      ? body.timeZone
      : booking.timeZone || "UTC";
    const targetSeatId = typeof body.seatId === "string" && body.seatId.trim() ? body.seatId.trim() : booking.seatId;

    if (!isValidBookingDate(targetDate)) {
      return NextResponse.json(
        { success: false, error: "Invalid booking date format. Use YYYY-MM-DD." },
        { status: 400 },
      );
    }

    if (!targetTime) {
      return NextResponse.json(
        { success: false, error: "Invalid booking time format. Use HH:MM." },
        { status: 400 },
      );
    }

    if (!Number.isInteger(targetDuration) || targetDuration < 30 || targetDuration > 480) {
      return NextResponse.json(
        { success: false, error: "Duration must be an integer between 30 and 480 minutes." },
        { status: 400 },
      );
    }

    const startsAt = parseBookingDateTime(targetDate, targetTime, targetTimeZone);
    if (!startsAt || startsAt.getTime() < Date.now() - PAST_GRACE_MS) {
      return NextResponse.json(
        { success: false, error: "You cannot reschedule a booking to a time in the past." },
        { status: 400 },
      );
    }

    // Check conflict and update atomically in a transaction
    const updatedBooking = await prisma.$transaction(async (tx) => {
      let seatNumber = booking.seatNumber;

      if (targetSeatId) {
        const seat = await tx.venueSeat.findFirst({
          where: {
            id: targetSeatId,
            venueId: booking.venueId,
            isEnabled: true,
          },
        });

        if (!seat) {
          throw new Error("SEAT_NOT_FOUND");
        }
        seatNumber = seat.seatNumber;

        // Query conflicting bookings for this seat, excluding the current booking being updated
        const existingBookings = await tx.booking.findMany({
          where: {
            id: { not: booking.id },
            seatId: targetSeatId,
            date: { in: conflictDateWindow(targetDate) },
            status: { in: ["CONFIRMED", "PENDING", "CHECKED_IN"] },
          },
          select: {
            date: true,
            time: true,
            duration: true,
            timeZone: true,
          },
        });

        if (
          hasBookingConflict(
            {
              date: targetDate,
              time: targetTime,
              timeZone: targetTimeZone,
              duration: targetDuration,
            },
            existingBookings,
          )
        ) {
          throw new Error("CONFLICT");
        }
      }

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          date: targetDate,
          time: targetTime,
          duration: targetDuration,
          timeZone: targetTimeZone,
          seatId: targetSeatId,
          seatNumber,
        },
        include: {
          venue: {
            select: { id: true, name: true, address: true, category: true },
          },
          seat: true,
        },
      });

      return updated;
    });

    publishVenueAvailability(booking.venueId, {
      type: "seat_rescheduled",
      bookingId: booking.id,
      seatId: targetSeatId,
      date: targetDate,
      time: targetTime,
      duration: targetDuration,
    });

    emitWebhookEvent(userId, "BOOKING_RESCHEDULED", {
      bookingId: booking.id,
      confirmationId: booking.confirmationId,
      venueId: booking.venueId,
      oldDate: booking.date,
      oldTime: booking.time,
      oldDuration: booking.duration,
      newDate: targetDate,
      newTime: targetTime,
      newDuration: targetDuration,
      rescheduledAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: "Booking rescheduled successfully.",
      booking: updatedBooking,
    });
  } catch (error: any) {
    if (error.message === "SEAT_NOT_FOUND") {
      return NextResponse.json(
        { success: false, error: "The requested seat could not be found." },
        { status: 404 },
      );
    }
    if (error.message === "CONFLICT") {
      return NextResponse.json(
        {
          success: false,
          error: "The requested time slot or desk is not available. Please choose another time or desk.",
        },
        { status: 409 },
      );
    }

    console.error("[PATCH /api/bookings/[bookingId]] Reschedule error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Unable to reschedule booking. Please try again.",
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/bookings/[bookingId]
 *
 * Cancels an authenticated user's booking when at least two hours remain
 * before its scheduled start time.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 },
      );
    }

    const { bookingId } = await context.params;

    if (!bookingId) {
      return NextResponse.json(
        {
          success: false,
          error: "Booking ID is required.",
        },
        { status: 400 },
      );
    }

    const booking = await prisma.booking.findFirst({
      where: {
        OR: [{ id: bookingId }, { confirmationId: bookingId }],
        userId,
      },
      select: {
        id: true,
        date: true,
        time: true,
        timeZone: true,
        status: true,
        confirmationId: true,
        venueId: true,
        seatId: true,
        duration: true,
        user: { select: { timezone: true } },
      },
    });

    if (!booking) {
      return NextResponse.json(
        {
          success: false,
          error: "Booking not found.",
        },
        { status: 404 },
      );
    }

    if (booking.status === "CANCELLED") {
      return NextResponse.json(
        {
          success: false,
          error: "This booking has already been cancelled.",
        },
        { status: 409 },
      );
    }

    const eligibility = getBookingCancellationEligibility({
      date: booking.date,
      time: booking.time,
      timeZone: booking.timeZone || booking.user?.timezone || null,
    });

    if (!eligibility.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: eligibility.message,
          code: eligibility.reason,
          cancellationWindowHours: 2,
          hoursUntilStart:
            eligibility.millisecondsUntilStart === null
              ? null
              : cancellationWindowHoursRemaining(
                  eligibility.millisecondsUntilStart,
                ),
        },
        { status: 400 },
      );
    }

    const cancelledAt = new Date();

    const cancellation = await prisma.$transaction(async (tx) => {
      // updateMany makes a concurrent duplicate cancellation harmless.
      const updated = await tx.booking.updateMany({
        where: {
          id: booking.id,
          userId,
          status: {
            not: "CANCELLED",
          },
        },
        data: {
          status: "CANCELLED",
        },
      });

      if (updated.count !== 1) {
        return {
          cancelled: false,
        } as const;
      }

      await tx.bookingGuest.updateMany({
        where: {
          bookingId: booking.id,
          status: {
            in: ["PENDING", "SENT"],
          },
        },
        data: {
          status: "CANCELLED",
        },
      });

      return {
        cancelled: true,
      } as const;
    });

    if (!cancellation.cancelled) {
      return NextResponse.json(
        {
          success: false,
          error: "The booking was already cancelled by another request.",
        },
        { status: 409 },
      );
    }

    emitWebhookEvent(userId, "BOOKING_CANCELLED", {
      bookingId: booking.id,
      confirmationId: booking.confirmationId,
      venueId: booking.venueId,
      date: booking.date,
      time: booking.time,
      cancelledAt: cancelledAt.toISOString(),
    });

    // Notify next eligible user on waitlist
    notifyNextInWaitlist(
      booking.venueId,
      booking.date,
      booking.time,
      booking.duration || 60,
      booking.seatId,
    ).catch((err) => {
      console.error("[Booking Cancellation] Waitlist notification failed:", err);
    });

    return NextResponse.json({
      success: true,
      message: "Booking cancelled successfully.",
      booking: {
        id: booking.id,
        status: "CANCELLED",
        cancelledAt: cancelledAt.toISOString(),
      },
    });
  } catch (error) {
    console.error(
      "[DELETE /api/bookings/[bookingId]] Cancellation error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Unable to cancel the booking. Please try again.",
      },
      { status: 500 },
    );
  }
}
