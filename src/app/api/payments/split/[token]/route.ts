import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySplitPaymentToken } from "@/lib/billing/splitPayment";
import { eventBus } from "@/core/events";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * `BookingGuest.status === "ACCEPTED"` only records that the guest answered
 * "yes" to the free email RSVP link. Whether they have actually paid is
 * tracked separately in `paidAt`; never infer payment from the RSVP status.
 */
const INACTIVE_GUEST_STATUSES = ["CANCELLED", "DECLINED"] as const;

function isInactiveGuest(status: string): boolean {
  return (INACTIVE_GUEST_STATUSES as readonly string[]).includes(status);
}

/**
 * GET /api/payments/split/[token]
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
    if (!guest) {
      return NextResponse.json({ error: "Invalid payment link" }, { status: 404 });
    }

    const isPaid = guest.paidAt != null;

    if (!isPaid) {
      if (booking.status === "CANCELLED") {
        return NextResponse.json(
          { error: "This booking was cancelled, so there is nothing to pay." },
          { status: 410 },
        );
      }
      if (isInactiveGuest(guest.status)) {
        return NextResponse.json(
          { error: "This invitation is no longer active." },
          { status: 409 },
        );
      }
    }

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
    console.error("[GET /api/payments/split/[token]] Error:", error);
    return NextResponse.json(
      { error: "Failed to load split payment details" },
      { status: 500 },
    );
  }
}

type PaymentOutcome =
  | { kind: "invalid" }
  | { kind: "booking_cancelled" }
  | { kind: "guest_inactive" }
  | { kind: "already_paid" }
  | {
      kind: "paid";
      booking: { date: string; time: string; venueName: string };
    };

/**
 * POST /api/payments/split/[token]
 * Processes guest payment and issues digital guest pass.
 *
 * The state check and the paid transition run in one transaction, and the
 * transition is a compare-and-set on `paidAt IS NULL`, so concurrent or
 * repeated submissions can only ever record (and announce) one payment.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const payload = verifySplitPaymentToken(token);

    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired payment token" }, { status: 400 });
    }

    const outcome: PaymentOutcome = await prisma.$transaction(async (tx) => {
      const guest = await tx.bookingGuest.findUnique({
        where: { id: payload.guestId },
        include: {
          booking: {
            select: {
              status: true,
              date: true,
              time: true,
              venue: { select: { name: true } },
            },
          },
        },
      });

      if (!guest || guest.bookingId !== payload.bookingId) {
        return { kind: "invalid" } as const;
      }
      if (guest.paidAt != null) {
        return { kind: "already_paid" } as const;
      }
      if (guest.booking.status === "CANCELLED") {
        return { kind: "booking_cancelled" } as const;
      }
      if (isInactiveGuest(guest.status)) {
        return { kind: "guest_inactive" } as const;
      }

      const marked = await tx.bookingGuest.updateMany({
        where: {
          id: guest.id,
          bookingId: payload.bookingId,
          paidAt: null,
          status: { notIn: [...INACTIVE_GUEST_STATUSES] },
        },
        data: {
          status: "ACCEPTED",
          paidAt: new Date(),
          paidAmountCents: Math.round(payload.amount * 100),
          paidCurrency: payload.currency,
        },
      });
      if (marked.count !== 1) {
        // Lost a race with a concurrent payment (or the guest was just cancelled).
        return { kind: "already_paid" } as const;
      }

      return {
        kind: "paid",
        booking: {
          date: guest.booking.date,
          time: guest.booking.time,
          venueName: guest.booking.venue?.name ?? payload.venueName,
        },
      } as const;
    });

    switch (outcome.kind) {
      case "invalid":
        return NextResponse.json({ error: "Invalid payment link" }, { status: 400 });
      case "booking_cancelled":
        return NextResponse.json(
          { error: "This booking was cancelled, so no payment is due." },
          { status: 410 },
        );
      case "guest_inactive":
        return NextResponse.json(
          { error: "This invitation is no longer active." },
          { status: 409 },
        );
      case "already_paid":
        return NextResponse.json({ success: true, message: "Already paid" });
    }

    // Announce only the request that actually recorded the payment. The payment
    // is already committed, so a notification failure must not turn it into a 500.
    try {
      await eventBus.emit("booking:guest-rsvp", {
        bookingId: payload.bookingId,
        guestId: payload.guestId,
        guestEmail: payload.email,
        status: "ACCEPTED",
      });
    } catch (err) {
      console.error("[POST /api/payments/split/[token]] guest-rsvp event failed:", err);
    }

    const passCode = `GP-${payload.bookingId.slice(-4).toUpperCase()}-${payload.guestId.slice(-4).toUpperCase()}`;

    // Booking details come from the database, not the token: the booking may
    // have been rescheduled since the link was issued.
    return NextResponse.json({
      success: true,
      message: "Guest Pass unlocked & payment confirmed!",
      guestPass: {
        passCode,
        guestName: payload.name || payload.email,
        venueName: outcome.booking.venueName,
        date: outcome.booking.date,
        time: outcome.booking.time,
        amountPaid: payload.amount,
        currency: payload.currency,
        wifiAccessCode: "WorkSphere-HighSpeed-Guest",
        accessLevel: "Full Coworking & Meeting Access",
      },
    });
  } catch (error: any) {
    console.error("[POST /api/payments/split/[token]] Error:", error);
    return NextResponse.json(
      { error: "Payment processing failed. Please try again." },
      { status: 500 },
    );
  }
}
