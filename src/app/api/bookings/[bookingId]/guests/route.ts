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
import { eventBus } from "@/core/events";
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

const rsvpSchema = z.object({
  guestId: z.string(),
  status: z.enum(["ACCEPTED", "DECLINED"]),
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
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const { searchParams } = new URL(req.url);
    const guestId = searchParams.get("guestId");
    const status = searchParams.get("status");

    // Public Guest RSVP route (from invite email)
    if (guestId && status) {
      if (status !== "ACCEPTED" && status !== "DECLINED") {
        return new NextResponse("Invalid status value", { status: 400 });
      }

      const { bookingId } = await params;

      const guest = await prisma.bookingGuest.findFirst({
        where: {
          id: guestId,
          bookingId,
        },
        include: {
          booking: {
            include: {
              venue: true,
            },
          },
        },
      });

      if (!guest) {
        return new NextResponse("Guest invitation not found", { status: 404 });
      }

      await prisma.bookingGuest.update({
        where: { id: guestId },
        data: { status: status as any },
      });

      await eventBus.emit("booking:guest-rsvp", {
        bookingId,
        guestId,
        guestEmail: guest.email,
        status,
      });

      const venueName = guest.booking.venue.name;
      const isAccepting = status === "ACCEPTED";
      const statusText = isAccepting ? "Accepted" : "Declined";
      const statusColor = isAccepting ? "#10b981" : "#ef4444";

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>RSVP Confirmation</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #ffffff; padding: 40px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); text-align: center; max-width: 450px; width: 100%; box-sizing: border-box; }
            .badge { display: inline-block; background-color: ${statusColor}; color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; margin-bottom: 20px; text-transform: uppercase; }
            h1 { font-size: 24px; color: #18181b; margin: 0 0 10px 0; }
            p { color: #52525b; font-size: 15px; margin: 0 0 20px 0; line-height: 1.5; }
            .venue { font-weight: bold; color: #7c3aed; }
            .footer { color: #a1a1aa; font-size: 12px; margin-top: 30px; border-top: 1px solid #e4e4e7; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">${statusText}</div>
            <h1>RSVP Submitted!</h1>
            <p>You have successfully ${statusText.toLowerCase()} the invitation to join the workspace session at <span class="venue">${venueName}</span>.</p>
            <div class="footer">Powered by WorkSphere</div>
          </div>
        </body>
        </html>
      `;

      return new NextResponse(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

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

// =============================================================================
// PATCH /api/bookings/[bookingId]/guests
// =============================================================================

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const { bookingId } = await params;
    const body = await req.json();

    const validation = rsvpSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: validation.error.format() },
        { status: 400 },
      );
    }

    const { guestId, status } = validation.data;

    // Verify the guest belongs to the booking
    const guest = await prisma.bookingGuest.findFirst({
      where: {
        id: guestId,
        bookingId,
      },
    });

    if (!guest) {
      return NextResponse.json(
        { error: "Guest invitation not found" },
        { status: 404 },
      );
    }

    // Update guest status
    const updatedGuest = await prisma.bookingGuest.update({
      where: { id: guestId },
      data: { status: status as any },
    });

    // Emit event for real-time notification
    await eventBus.emit("booking:guest-rsvp", {
      bookingId,
      guestId,
      guestEmail: guest.email,
      status,
    });

    return NextResponse.json({
      success: true,
      guest: updatedGuest,
    });
  } catch (error: any) {
    console.error("[PATCH /api/bookings/[bookingId]/guests] Error:", error);
    return NextResponse.json(
      { error: "Failed to update RSVP status" },
      { status: 500 },
    );
  }
}
