import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  cancellationWindowHoursRemaining,
  getBookingCancellationEligibility,
} from "@/lib/bookingCancellation";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    bookingId: string;
  }>;
};

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
        id: bookingId,
        userId,
      },
      select: {
        id: true,
        date: true,
        time: true,
        status: true,
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
