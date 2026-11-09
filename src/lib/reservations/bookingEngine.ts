import { PrismaClient } from "@prisma/client";

export interface BookingResult {
  success: boolean;
  reservation?: any;
  error?: string;
  isConflict?: boolean;
}

/**
 * Attempts to reserve a seat concurrently using PostgreSQL transaction-level advisory locks.
 */
export async function bookSeatWithAdvisoryLock(
  prisma: PrismaClient,
  seatId: string,
  userId: string,
  startTime: Date,
  endTime: Date,
): Promise<BookingResult> {
  return await prisma.$transaction(async (tx) => {
    // 1. Acquire transaction-level advisory lock on seat ID hash
    const lockKey = `seat:${seatId}`;
    const lockAcquired = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired;
    `;

    if (!lockAcquired[0]?.acquired) {
      return {
        success: false,
        isConflict: true,
        error: "Seat currently being reserved by another user",
      };
    }

    // 2. Double-check availability inside the locked transaction
    const existing = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Reservation"
      WHERE "seatId" = ${seatId}
        AND "status" = 'CONFIRMED'
        AND "startTime" < ${endTime}
        AND "endTime" > ${startTime};
    `;

    if (existing[0] && Number(existing[0].count) > 0) {
      return {
        success: false,
        isConflict: true,
        error: "Seat is already booked for the selected time slot",
      };
    }

    // 3. Create reservation record
    const reservation = await tx.$queryRaw`
      INSERT INTO "Reservation" ("id", "seatId", "userId", "startTime", "endTime", "status", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${seatId}, ${userId}, ${startTime}, ${endTime}, 'CONFIRMED', NOW(), NOW())
      RETURNING *;
    `;

    return {
      success: true,
      reservation,
    };
  });
}
