/**
 * API Route: /api/bookings/[bookingId]/guests
 *
 * Manages guest invitations for a specific booking.
 * - POST: Add guests and send invitations
 * - GET: List guests for a booking
 * - DELETE: Cancel/rescind a guest invitation
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import {
  inviteGuestsToBooking,
  getBookingGuests,
  cancelGuestInvitations,
} from "@/lib/guests";
import "@/core/subscribers/guests";
import { z } from "zod";

// =============================================================================
// Validation Schemas
// =============================================================================

const addGuestSchema = z.object({
  guests: z
    .array(
      z.object({
        email: z.string().email("Invalid email address"),
        name: z.string().max(100).optional(),
        phone: z.string().max(20).optional(),
      }),
    )
    .min(1, "At least one guest is required")
    .max(20, "Maximum 20 guests per request"),
});

const cancelGuestSchema = z.object({
  guestId: z.string().uuid("Invalid guest ID").optional(),
  email: z.string().email("Invalid email").optional(),
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Verify the requesting user owns the booking.
 */
async function verifyBookingOwnership(bookingId: string, userId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true, id: true },
  });

  if (!booking) {
    return { error: "Booking not found", status: 404 } as const;
  }

  if (booking.userId !== userId) {
    return {
      error: "Forbidden: you do not own this booking",
      status: 403,
    } as const;
  }

  return { booking, error: null, status: 200 } as const;
}

// =============================================================================
// GET /api/bookings/[bookingId]/guests
// =============================================================================

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookingId } = await params;

    const ownership = await verifyBookingOwnership(bookingId, userId);
    if (ownership.error) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status },
      );
    }

    const guests = await getBookingGuests(bookingId);

    return NextResponse.json({ guests });
  } catch (error: any) {
    console.error("[GET /api/bookings/[bookingId]/guests] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch guests" },
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/bookings/[bookingId]/guests
// =============================================================================

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    const { bookingId } = await params;

    // Verify booking ownership
    const ownership = await verifyBookingOwnership(bookingId, userId);
    if (ownership.error) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status },
      );
    }

    // Parse and validate request body
    const body = await req.json();
    const validation = addGuestSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: validation.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }

    const { guests } = validation.data;

    // Fetch booking details for the invite flow
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        venue: true,
        user: true,
      },
    });

    if (!booking || !booking.venue) {
      return NextResponse.json(
        { error: "Booking or venue not found" },
        { status: 404 },
      );
    }

    const hostName =
      [booking.user.firstName, booking.user.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || booking.customerEmail;

    // Send invitations
    const results = await inviteGuestsToBooking(
      bookingId,
      guests.map((g) => ({
        email: g.email,
        name: g.name,
        phone: g.phone,
      })),
      async () => ({
        venue: {
          name: booking.venue!.name,
          address: booking.venue!.address || "",
          latitude: booking.venue!.latitude,
          longitude: booking.venue!.longitude,
          photoUrl: booking.venue!.imageUrl || undefined,
        },
        host: {
          name: hostName,
          email: booking.customerEmail,
        },
        booking: {
          confirmationId: booking.confirmationId,
          date: booking.date,
          time: booking.time,
          durationMinutes: booking.duration || 60,
        },
      }),
    );

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: results.length,
        sent: successCount,
        failed: failCount,
      },
    });
  } catch (error: any) {
    console.error("[POST /api/bookings/[bookingId]/guests] Error:", error);
    return NextResponse.json(
      { error: "Failed to send invitations" },
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE /api/bookings/[bookingId]/guests
// =============================================================================

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookingId } = await params;

    const ownership = await verifyBookingOwnership(bookingId, userId);
    if (ownership.error) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status },
      );
    }

    // If specific guest ID or email is provided, cancel just that one
    const body = await req.json().catch(() => ({}));
    const validation = cancelGuestSchema.safeParse(body);

    if (
      validation.success &&
      (validation.data.guestId || validation.data.email)
    ) {
      const { guestId, email } = validation.data;

      await prisma.bookingGuest.updateMany({
        where: {
          bookingId,
          ...(guestId ? { id: guestId } : {}),
          ...(email ? { email } : {}),
          status: { in: ["PENDING", "SENT"] },
        },
        data: { status: "CANCELLED" },
      });

      return NextResponse.json({
        success: true,
        message: "Guest invitation cancelled",
      });
    }

    // If no specific guest, cancel all pending/sent invitations
    await cancelGuestInvitations(bookingId);

    return NextResponse.json({
      success: true,
      message: "All guest invitations cancelled",
    });
  } catch (error: any) {
    console.error("[DELETE /api/bookings/[bookingId]/guests] Error:", error);
    return NextResponse.json(
      { error: "Failed to cancel invitations" },
      { status: 500 },
    );
  }
}
