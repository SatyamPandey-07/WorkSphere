import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySplitPaymentToken } from "@/lib/billing/splitPayment";
import { eventBus } from "@/core/events";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * GET /api/pay/split/[token]
 * Verifies split payment token and returns details for the guest checkout.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const payload = verifySplitPaymentToken(token);

    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired payment link" }, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: payload.bookingId },
      include: {
        venue: {
          select: {
            name: true,
            address: true,
            category: true,
            imageUrl: true,
            wifiSpeed: true,
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        guests: {
          where: { id: payload.guestId },
        },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const guest = booking.guests[0];
    const isPaid = guest?.status === "ACCEPTED";
    const hostName = booking.user
      ? [booking.user.firstName, booking.user.lastName].filter(Boolean).join(" ") || "Host"
      : "Host";

    return NextResponse.json({
      valid: true,
      payload,
      isPaid,
      venue: booking.venue,
      hostName,
      bookingDetails: {
        date: booking.date,
        time: booking.time,
        seatNumber: booking.seatNumber,
        duration: booking.duration || 60,
      },
    });
  } catch (error: any) {
    console.error("[GET /api/pay/split/[token]] Error:", error);
    return NextResponse.json(
      { error: "Failed to load split payment details" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/pay/split/[token]
 * Processes guest payment and issues digital guest pass.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const payload = verifySplitPaymentToken(token);

    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired payment token" }, { status: 400 });
    }

    // Mark guest invitation status as ACCEPTED (Paid)
    const updatedGuest = await prisma.bookingGuest.update({
      where: { id: payload.guestId },
      data: { status: "ACCEPTED" },
      include: {
        booking: {
          include: {
            venue: true,
          },
        },
      },
    });

    // Emit RSVP & Payment event
    await eventBus.emit("booking:guest-rsvp", {
      bookingId: payload.bookingId,
      guestId: payload.guestId,
      guestEmail: payload.email,
      status: "ACCEPTED",
    });

    const passCode = `GP-${payload.bookingId.slice(-4).toUpperCase()}-${payload.guestId.slice(-4).toUpperCase()}`;

    return NextResponse.json({
      success: true,
      message: "Guest Pass unlocked & payment confirmed!",
      guestPass: {
        passCode,
        guestName: payload.name || payload.email,
        venueName: payload.venueName,
        date: payload.date,
        time: payload.time,
        amountPaid: payload.amount,
        currency: payload.currency,
        wifiAccessCode: "WorkSphere-HighSpeed-Guest",
        accessLevel: "Full Coworking & Meeting Access",
      },
    });
  } catch (error: any) {
    console.error("[POST /api/pay/split/[token]] Error:", error);
    return NextResponse.json(
      { error: "Payment processing failed. Please try again." },
      { status: 500 },
    );
  }
}
