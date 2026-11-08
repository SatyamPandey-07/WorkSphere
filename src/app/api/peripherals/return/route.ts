/**
 * route.ts
 * POST /api/peripherals/return
 * Handles item return to locker bay, computes elapsed hours, and releases refundable deposit.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  calculateRentalCompletion,
  peripheralLockManager,
  type PeripheralRental,
} from "@/lib/peripherals/peripheralEngine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rental } = body;

    if (!rental || !rental.rentalId) {
      return NextResponse.json({ error: "Missing rental payload" }, { status: 400 });
    }

    const completion = calculateRentalCompletion(rental as PeripheralRental);
    peripheralLockManager.completeRental(rental.rentalId);

    return NextResponse.json({
      success: true,
      message: `Item returned to Locker Bay #${rental.lockerBayNumber}. Locker door locked securely.`,
      summary: {
        rentalId: rental.rentalId,
        durationHours: completion.durationHours,
        rentalCostUsd: completion.rentalCost,
        depositRefundedUsd: completion.refundedDeposit,
        status: "COMPLETED",
        returnedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("[POST /api/peripherals/return] Error:", error);
    return NextResponse.json(
      { error: "Failed to process item return", details: error.message },
      { status: 500 }
    );
  }
}
