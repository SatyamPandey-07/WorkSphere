/**
 * route.ts
 * POST /api/peripherals/checkout
 * Initiates hardware rental, places deposit hold, and generates 4-digit locker unlock PIN.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  generateLockerPin,
  peripheralLockManager,
  type PeripheralRental,
} from "@/lib/peripherals/peripheralEngine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      itemId,
      userId = "user_nomad_demo",
      venueId = "venue-sf-01",
      hourlyRate = 2.5,
      depositAmount = 40.0,
      lockerBayNumber = 1,
    } = body;

    if (!itemId) {
      return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
    }

    // Atomic lock acquisition to prevent concurrent double-checkout race conditions
    const lockAcquired = peripheralLockManager.tryAcquireLock(itemId, userId);
    if (!lockAcquired) {
      return NextResponse.json(
        {
          error: "This hardware item is currently undergoing checkout or is already rented.",
          code: "PERIPHERAL_ALREADY_RESERVED",
        },
        { status: 409 }
      );
    }

    const unlockPin = generateLockerPin(itemId, userId);
    const rentalId = `RENT-${Date.now().toString().slice(-6)}-BAY${lockerBayNumber}`;

    const rental: PeripheralRental = {
      rentalId,
      itemId,
      userId,
      venueId,
      lockerBayNumber,
      unlockPin,
      depositAmount,
      hourlyRate,
      startTime: new Date().toISOString(),
      status: "ACTIVE",
    };

    // Register active rental
    peripheralLockManager.registerRental(rental);

    return NextResponse.json({
      success: true,
      message: `Locker Bay #${lockerBayNumber} Unlocked!`,
      rental,
      instructions: `Enter PIN ${unlockPin} on Locker Bay #${lockerBayNumber} keypad or tap QR code to open.`,
    });
  } catch (error: any) {
    console.error("[POST /api/peripherals/checkout] Error:", error);
    return NextResponse.json(
      { error: "Failed to checkout peripheral", details: error.message },
      { status: 500 }
    );
  }
}

