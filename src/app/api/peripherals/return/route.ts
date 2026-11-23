/**
 * route.ts
 * POST /api/peripherals/return
 * Handles item return to locker bay, computes elapsed hours and refunds from server records,
 * enforces ownership verification, and marks rental completed in database.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  calculateRentalCompletion,
  peripheralLockManager,
} from "@/lib/peripherals/peripheralEngine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const rentalId = body.rentalId || (body.rental && body.rental.rentalId);

    if (!rentalId || typeof rentalId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid rentalId in request payload" },
        { status: 400 },
      );
    }

    // Look up persistent rental from database
    const rental = await prisma.peripheralRental.findUnique({
      where: { rentalId },
    });

    if (!rental) {
      return NextResponse.json(
        { error: "Rental record not found", code: "RENTAL_NOT_FOUND" },
        { status: 404 },
      );
    }

    // Verify ownership: caller must be the user who initiated the checkout
    if (rental.userId !== userId) {
      return NextResponse.json(
        {
          error: "Forbidden: Cannot return a rental belonging to another user",
          code: "FORBIDDEN",
        },
        { status: 403 },
      );
    }

    // Idempotent return: if already completed, return existing completion summary
    if (rental.status === "COMPLETED") {
      const returnTime = rental.endTime || rental.updatedAt;
      const completion = calculateRentalCompletion(
        rental,
        new Date(returnTime),
      );

      return NextResponse.json({
        success: true,
        message: `Item was already returned to Locker Bay #${rental.lockerBayNumber}.`,
        summary: {
          rentalId: rental.rentalId,
          durationHours: completion.durationHours,
          rentalCostUsd: rental.totalCostUsd ?? completion.rentalCost,
          depositRefundedUsd: completion.refundedDeposit,
          status: "COMPLETED",
          returnedAt: new Date(returnTime).toISOString(),
        },
      });
    }

    // Transactionally update rental in database
    const returnTime = new Date();
    const completion = calculateRentalCompletion(rental, returnTime);

    const updated = await prisma.peripheralRental.update({
      where: { rentalId },
      data: {
        status: "COMPLETED",
        endTime: returnTime,
        totalCostUsd: completion.rentalCost,
      },
    });

    // Clear any memory locks
    peripheralLockManager.completeRental(rentalId);

    return NextResponse.json({
      success: true,
      message: `Item returned to Locker Bay #${rental.lockerBayNumber}. Locker door locked securely.`,
      summary: {
        rentalId: updated.rentalId,
        durationHours: completion.durationHours,
        rentalCostUsd: completion.rentalCost,
        depositRefundedUsd: completion.refundedDeposit,
        status: "COMPLETED",
        returnedAt: returnTime.toISOString(),
      },
    });
  } catch (error: any) {
    console.error("[POST /api/peripherals/return] Error:", error);
    return NextResponse.json(
      { error: "Failed to process item return", details: error.message },
      { status: 500 },
    );
  }
}
