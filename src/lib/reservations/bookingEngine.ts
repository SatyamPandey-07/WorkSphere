import { PrismaClient } from "@prisma/client";
import {
  RedlockManager,
  getRedlockManager,
  LockLostError,
} from "@/lib/redis/RedlockManager";

export interface BookingResult {
  success: boolean;
  reservation?: any;
  error?: string;
  isConflict?: boolean;
  fencingToken?: number;
}

export interface BookingOptions {
  redlockManager?: RedlockManager | null;
  lockTtlMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  useSlotLevelLock?: boolean;
  withFencingToken?: boolean;
}

/**
 * Attempts to reserve a seat concurrently using PostgreSQL transaction-level advisory locks
 * and distributed Redlock across multi-node Redis clusters.
 */
export async function bookSeatWithAdvisoryLock(
  prisma: PrismaClient,
  seatId: string,
  userId: string,
  startTime: Date,
  endTime: Date,
  options?: BookingOptions | RedlockManager,
): Promise<BookingResult> {
  const isManagerInstance = options instanceof RedlockManager;
  const bookingOpts = !isManagerInstance ? options : undefined;

  const lockManager = isManagerInstance
    ? options
    : options?.redlockManager !== undefined
    ? options.redlockManager
    : getRedlockManager();

  const lockTtlMs = bookingOpts?.lockTtlMs ?? 5000;
  const useSlotLevel = bookingOpts?.useSlotLevelLock ?? false;
  const withFencingToken = bookingOpts?.withFencingToken ?? true;

  if (lockManager) {
    const datePrefix = startTime.toISOString().slice(0, 10);
    const lockKey = useSlotLevel
      ? `seat:${seatId}:${datePrefix}`
      : `seat:${seatId}`;

    const lock = await lockManager.acquire(lockKey, lockTtlMs, {
      autoRenew: true,
      retryCount: bookingOpts?.retryCount ?? 1,
      retryDelayMs: bookingOpts?.retryDelayMs ?? 100,
      withFencingToken,
    });
    if (!lock) {
      return {
        success: false,
        isConflict: true,
        error: "Seat currently being reserved by another user",
      };
    }

    try {
      lock.checkLost();
      return await prisma.$transaction(async (tx) => {
        lock.checkLost();
        // 1. Acquire transaction-level advisory lock on seat ID hash
        const pgLockKey = `seat:${seatId}`;
        const lockAcquired = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${pgLockKey})) AS acquired;
        `;

        if (!lockAcquired[0]?.acquired) {
          return {
            success: false,
            isConflict: true,
            error: "Seat currently being reserved by another user",
          };
        }

        // 2. Double-check availability inside the locked transaction
        lock.checkLost();
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
        lock.checkLost();
        const reservation = await tx.$queryRaw`
          INSERT INTO "Reservation" ("id", "seatId", "userId", "startTime", "endTime", "status", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${seatId}, ${userId}, ${startTime}, ${endTime}, 'CONFIRMED', NOW(), NOW())
          RETURNING *;
        `;

        return {
          success: true,
          reservation,
          fencingToken: lock.fencingToken,
        };
      });
    } catch (err: any) {
      if (err instanceof LockLostError || err?.code === "LOCK_LOST") {
        return {
          success: false,
          isConflict: true,
          error: "Seat reservation aborted: distributed lock lease was lost",
        };
      }
      throw err;
    } finally {
      await lock.release();
    }
  }

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
