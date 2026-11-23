/**
 * route.ts
 * POST /api/peripherals/checkout
 * Initiates hardware rental, places deposit hold, persists record in database, and generates secure locker unlock PIN.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  generateLockerPin,
  peripheralLockManager,
  type PeripheralRental,
} from "@/lib/peripherals/peripheralEngine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      itemId,
      venueId = "venue-sf-01",
      hourlyRate = 2.5,
      depositAmount = 40.0,
      lockerBayNumber = 1,
    } = body;

    if (!itemId) {
      return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
    }

    // Check database for an existing active rental of this hardware item
    const existingActive = await prisma.peripheralRental.findFirst({
      where: {
        itemId,
        status: "ACTIVE",
      },
    });

    if (existingActive) {
      return NextResponse.json(
        {
          error:
            "This hardware item is currently undergoing checkout or is already rented.",
          code: "PERIPHERAL_ALREADY_RESERVED",
        },
        { status: 409 },
      );
    }

    // Atomic in-process lock acquisition to prevent concurrent double-checkout race conditions
    const lockAcquired = peripheralLockManager.tryAcquireLock(itemId, userId);
    if (!lockAcquired) {
      return NextResponse.json(
        {
          error:
            "This hardware item is currently undergoing checkout or is already rented.",
          code: "PERIPHERAL_ALREADY_RESERVED",
        },
        { status: 409 },
      );
    }

    const unlockPin = generateLockerPin(itemId, userId);
    const rentalId = `RENT-${Date.now().toString().slice(-6)}-BAY${lockerBayNumber}`;

    // Persist durable rental record in PostgreSQL via Prisma
    const created = await prisma.peripheralRental.create({
      data: {
        rentalId,
        itemId,
        userId,
        venueId,
        lockerBayNumber: Number(lockerBayNumber),
        unlockPin,
        depositAmount: Number(depositAmount),
        hourlyRate: Number(hourlyRate),
        status: "ACTIVE",
      },
    });

    const rental: PeripheralRental = {
      rentalId: created.rentalId,
      itemId: created.itemId,
      userId: created.userId,
      venueId: created.venueId,
      lockerBayNumber: created.lockerBayNumber,
      unlockPin: created.unlockPin,
      depositAmount: created.depositAmount,
      hourlyRate: created.hourlyRate,
      startTime: created.startTime.toISOString(),
      status: "ACTIVE",
    };

    // Register active rental in lock manager
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
      { status: 500 },
    );
  }
}
