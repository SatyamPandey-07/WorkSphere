/**
 * route.ts
 * POST /api/bookings/bundles/verify
 * Allows venues to scan and verify a user's Work-Hop QR Pass and redeem the current leg.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWorkHopPassToken } from "@/lib/bundles/workHopEngine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { qrToken, venueId, legIndex } = body;

    if (!qrToken) {
      return NextResponse.json({ error: "Missing QR pass token" }, { status: 400 });
    }

    const verification = verifyWorkHopPassToken(qrToken);
    if (!verification.isValid) {
      return NextResponse.json(
        { error: verification.error || "Invalid or counterfeit pass" },
        { status: 401 }
      );
    }

    // Verify corresponding booking record
    const todayStr = new Date().toISOString().split("T")[0];
    const matchingBooking = await prisma.booking.findFirst({
      where: {
        userId: verification.userId,
        projectBillingCode: { contains: verification.bundleId },
        ...(venueId ? { venueId } : {}),
      },
      include: { venue: true },
    });

    if (!matchingBooking) {
      return NextResponse.json(
        { error: "No matching booking leg found for this pass at this venue" },
        { status: 404 }
      );
    }

    // Mark as checked in
    const updated = await prisma.booking.update({
      where: { id: matchingBooking.id },
      data: { status: "CHECKED_IN" },
    });

    return NextResponse.json({
      success: true,
      verified: true,
      message: "Pass verified and leg check-in successful!",
      redemption: {
        bundleId: verification.bundleId,
        venueName: matchingBooking.venue.name,
        seatNumber: matchingBooking.seatNumber || "Assigned at Door",
        date: matchingBooking.date,
        time: matchingBooking.time,
        status: "CHECKED_IN",
        checkedInAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("[POST /api/bookings/bundles/verify] Error:", error);
    return NextResponse.json(
      { error: "Verification error", details: error.message },
      { status: 500 }
    );
  }
}
