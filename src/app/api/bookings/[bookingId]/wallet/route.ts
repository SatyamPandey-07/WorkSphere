import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  buildApplePassJson,
  buildGoogleWalletPass,
} from "@/lib/wallet/passService";

type RouteContext = {
  params: Promise<{
    bookingId: string;
  }>;
};

/**
 * GET /api/bookings/[bookingId]/wallet
 * Retrieves Apple Wallet Pass JSON and Google Wallet save link.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookingId } = await context.params;
    if (!bookingId) {
      return NextResponse.json({ error: "Booking ID is required" }, { status: 400 });
    }

    const booking = await prisma.booking.findFirst({
      where: {
        OR: [{ id: bookingId }, { confirmationId: bookingId }],
        userId,
      },
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            category: true,
            address: true,
            latitude: true,
            longitude: true,
            imageUrl: true,
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const applePass = buildApplePassJson(booking as any);
    const googleWallet = buildGoogleWalletPass(booking as any);

    return NextResponse.json({
      success: true,
      booking: {
        id: booking.id,
        confirmationId: booking.confirmationId,
        date: booking.date,
        time: booking.time,
        seatNumber: booking.seatNumber,
        venueName: booking.venue?.name,
      },
      applePass,
      googleWallet: {
        saveUrl: googleWallet.saveUrl,
        payload: googleWallet.passPayload,
      },
      downloadUrls: {
        apple: `/api/bookings/${booking.id}/wallet/apple`,
        google: googleWallet.saveUrl,
      },
    });
  } catch (error) {
    console.error("[GET /api/bookings/[bookingId]/wallet] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate wallet pass" },
      { status: 500 },
    );
  }
}
