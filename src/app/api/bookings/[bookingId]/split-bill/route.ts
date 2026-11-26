import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { calculateSplitBill } from "@/lib/billing/splitPayment";
import { z } from "zod";

type RouteContext = { params: Promise<{ bookingId: string }> };

const splitBillBodySchema = z.object({
  totalAmount: z
    .number()
    .finite("totalAmount must be a finite number")
    .positive("totalAmount must be greater than 0")
    .max(100000, "totalAmount cannot exceed 100000")
    .optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "currency must be a 3-letter uppercase code")
    .optional(),
  customGuestAmounts: z
    .record(
      z.string(),
      z
        .number()
        .finite("custom amount must be a finite number")
        .nonnegative("custom amount cannot be negative"),
    )
    .optional(),
});

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
    const baseHourlyRate =
      booking.venue?.category === "coworking_space" ? 20 : 15;
    const durationHours = (booking.duration || 60) / 60;
    const totalAmount = Math.max(
      10,
      Math.round(baseHourlyRate * durationHours * 100) / 100,
    );

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
        paid: g.paidAt != null,
        paymentStatus: g.paymentStatus || undefined,
        paymentReference: g.paymentReference || undefined,
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
      return NextResponse.json(
        { error: "Booking not found or unauthorized" },
        { status: 404 },
      );
    }

    const body = await req.json().catch(() => ({}));

    const parseResult = splitBillBodySchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parseResult.error.errors },
        { status: 400 },
      );
    }

    const {
      totalAmount: rawAmount = 30,
      currency = "USD",
      customGuestAmounts = {},
    } = parseResult.data;

    const totalAmount = Math.round(rawAmount * 100) / 100;

    const validGuestIds = new Set(booking.guests.map((g) => g.id));
    for (const guestId of Object.keys(customGuestAmounts)) {
      if (!validGuestIds.has(guestId)) {
        return NextResponse.json(
          { error: `Unknown guest ID: ${guestId}` },
          { status: 400 },
        );
      }
    }

    const totalCustomAllocationCents = Object.values(customGuestAmounts).reduce(
      (sum, amt) => sum + Math.round(amt * 100),
      0,
    );
    const totalCents = Math.round(totalAmount * 100);
    if (totalCustomAllocationCents > totalCents) {
      return NextResponse.json(
        {
          error: `Total custom guest amounts (${totalCustomAllocationCents / 100}) exceed the total bill amount (${totalAmount})`,
        },
        { status: 400 },
      );
    }

    const url = new URL(req.url);
    const origin = url.origin;

    const split = calculateSplitBill({
      bookingId: booking.id,
      venueName: booking.venue?.name || "Workspace",
      date: booking.date,
      time: booking.time,
      totalAmount,
      currency,
      guests: booking.guests.map((g) => ({
        id: g.id,
        email: g.email,
        name: g.name || undefined,
        paid: g.paidAt != null,
        paymentStatus: g.paymentStatus || undefined,
        paymentReference: g.paymentReference || undefined,
        customAmount: customGuestAmounts[g.id],
      })),
      origin,
    });

    return NextResponse.json({ success: true, split });
  } catch (error: any) {
    console.error("[POST /api/bookings/[bookingId]/split-bill] Error:", error);
    const isValidationError =
      error?.message?.includes("exceed") ||
      error?.message?.includes("must be") ||
      error?.message?.includes("Custom amount");
    return NextResponse.json(
      { error: error.message || "Failed to generate split bill links" },
      { status: isValidationError ? 400 : 500 },
    );
  }
}
