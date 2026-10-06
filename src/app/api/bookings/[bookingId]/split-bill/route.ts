import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { calculateSplitBill } from "@/lib/billing/splitPayment";

type RouteContext = { params: Promise<{ bookingId: string }> };

/**
 * GET /api/bookings/[bookingId]/split-bill
 * Returns the split bill breakdown and guest payment links for a booking.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookingId } = await context.params;
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        venue: {
          select: { id: true, name: true, address: true, category: true },
        },
        guests: true,
      },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (booking.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const origin = url.origin;

    // Estimate base total amount if not explicitly stored (e.g. $15/hr or $25 meeting room base)
    const baseHourlyRate = booking.venue?.category === "coworking_space" ? 20 : 15;
    const durationHours = (booking.duration || 60) / 60;
    const totalAmount = Math.max(10, Math.round(baseHourlyRate * durationHours * 100) / 100);

    const split = calculateSplitBill({
      bookingId: booking.id,
      venueName: booking.venue?.name || "Workspace",
      date: booking.date,
      time: booking.time,
      totalAmount,
      currency: "USD",
      guests: booking.guests.map((g) => ({
        id: g.id,
        email: g.email,
        name: g.name || undefined,
        paid: g.status === "ACCEPTED",
      })),
      origin,
    });

    return NextResponse.json({ split, booking });
  } catch (error: any) {
    console.error("[GET /api/bookings/[bookingId]/split-bill] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to calculate split bill" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/bookings/[bookingId]/split-bill
 * Calculates or customizes split amounts across guests.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookingId } = await context.params;
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        venue: {
          select: { id: true, name: true, address: true },
        },
        guests: true,
      },
    });

    if (!booking || booking.userId !== userId) {
      return NextResponse.json({ error: "Booking not found or unauthorized" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const totalAmount = typeof body.totalAmount === "number" ? body.totalAmount : 30;
    const customGuestAmounts: Record<string, number> = body.customGuestAmounts || {};

    const url = new URL(req.url);
    const origin = url.origin;

    const split = calculateSplitBill({
      bookingId: booking.id,
      venueName: booking.venue?.name || "Workspace",
      date: booking.date,
      time: booking.time,
      totalAmount,
      currency: body.currency || "USD",
      guests: booking.guests.map((g) => ({
        id: g.id,
        email: g.email,
        name: g.name || undefined,
        paid: g.status === "ACCEPTED",
        customAmount: customGuestAmounts[g.id],
      })),
      origin,
    });

    return NextResponse.json({ success: true, split });
  } catch (error: any) {
    console.error("[POST /api/bookings/[bookingId]/split-bill] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate split bill links" },
      { status: 500 },
    );
  }
}
