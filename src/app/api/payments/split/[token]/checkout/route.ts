import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySplitPaymentToken } from "@/lib/billing/splitPayment";
import { defaultPaymentProvider } from "@/lib/billing/paymentProvider";
import { rateLimit } from "@/lib/rateLimit";

type RouteContext = { params: Promise<{ token: string }> };

const INACTIVE_GUEST_STATUSES = ["CANCELLED", "DECLINED"] as const;

function isInactiveGuest(status: string): boolean {
  return (INACTIVE_GUEST_STATUSES as readonly string[]).includes(status);
}

/**
 * POST /api/payments/split/[token]/checkout
 * Creates a verified payment-provider checkout session for a guest split bill.
 * Uses trusted server-side amounts and guarantees that payments cannot be forged
 * with client-modified parameters.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ip =
      req?.headers?.get?.("x-forwarded-for")?.split(",")[0].trim() ||
      req?.headers?.get?.("x-real-ip") ||
      "anonymous";
    const allowed = await rateLimit(`split-checkout:${ip}`, 30, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    const { token } = await context.params;
    const payload = verifySplitPaymentToken(token);

    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired payment token" },
        { status: 400 },
      );
    }

    const booking = await prisma.booking.findUnique({
      where: { id: payload.bookingId },
      include: {
        venue: {
          select: { name: true },
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
      return NextResponse.json(
        { error: "Invalid payment link" },
        { status: 404 },
      );
    }

    if (guest.paidAt != null) {
      return NextResponse.json(
        { error: "Guest share is already paid" },
        { status: 409 },
      );
    }

    if (
      booking.status === "CANCELLED" ||
      booking.status === "CANCELLED_BY_OPERATOR"
    ) {
      return NextResponse.json(
        { error: "This booking was cancelled, so no payment is due." },
        { status: 410 },
      );
    }

    if (isInactiveGuest(guest.status)) {
      return NextResponse.json(
        { error: "This invitation is no longer active." },
        { status: 409 },
      );
    }

    // Amounts are strictly derived server-side from canonical guest allocation
    const amountCents = Math.round(payload.amount * 100);
    const currency = (payload.currency || "USD").toUpperCase();

    const session = await defaultPaymentProvider.createCheckoutSession({
      bookingId: payload.bookingId,
      guestId: payload.guestId,
      amountCents,
      currency,
      guestEmail: guest.email,
      guestName: guest.name || undefined,
      venueName: booking.venue?.name || payload.venueName,
      token,
    });

    return NextResponse.json({
      success: true,
      sessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
      provider: session.provider,
      amountCents: session.amountCents,
      currency: session.currency,
    });
  } catch (error: any) {
    console.error("[POST /api/payments/split/[token]/checkout] Error:", error);
    return NextResponse.json(
      { error: "Failed to initiate payment checkout" },
      { status: 500 },
    );
  }
}
