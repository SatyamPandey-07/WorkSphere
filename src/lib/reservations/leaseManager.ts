import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export interface AcquireHoldParams {
  venueId: string;
  seatIds: string[];
  userId: string;
  durationMinutes?: number;
}

export interface AcquireHoldResult {
  success: boolean;
  holdIds?: string[];
  error?: string;
}

/**
 * Execute a operation with exponential backoff and jitter on PostgreSQL serialization/deadlock failures (40P01 / 40001).
 */
export async function withTransactionRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 50,
): Promise<T> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      const isDeadlock =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" ||
          error.message.includes("40P01") ||
          error.message.includes("40001") ||
          error.message.includes("deadlock detected"));

      if (isDeadlock && attempt < maxRetries) {
        attempt++;
        const jitter = Math.random() * 0.5 + 0.75; // 0.75 - 1.25 multiplier
        const delay = Math.floor(baseDelayMs * Math.pow(2, attempt) * jitter);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max transaction retries exceeded");
}

/**
 * Acquire desk holds using deterministic row locking and transaction-level advisory locks.
 */
export async function acquireDeskHold(
  params: AcquireHoldParams,
): Promise<AcquireHoldResult> {
  const { venueId, seatIds, userId, durationMinutes = 15 } = params;

  // Enforce deterministic lock acquisition order by sorting seat IDs
  const sortedSeatIds = [...seatIds].sort();

  return withTransactionRetry(async () => {
    return await prisma.$transaction(
      async (tx) => {
        // 1. Transaction-level advisory lock serialized by venue_id to prevent inverted lock cycles
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(concat('venue:', ${venueId}::text)))`;

        // 2. Lock target seat rows deterministically in ascending seatId order
        const seats = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id, status FROM "Seat"
          WHERE id IN (${Prisma.join(sortedSeatIds)})
          ORDER BY id ASC
          FOR UPDATE
        `;

        if (seats.length !== sortedSeatIds.length) {
          return { success: false, error: "One or more seats do not exist" };
        }

        // Check availability
        const unavailable = seats.filter((s) => s.status !== "AVAILABLE");
        if (unavailable.length > 0) {
          return {
            success: false,
            error: "One or more selected seats are unavailable",
          };
        }

        // 3. Check for existing active holds
        const now = new Date();
        const existingHolds = await tx.$queryRaw<Array<{ seatId: string }>>`
          SELECT "seatId" FROM "DeskHold"
          WHERE "seatId" IN (${Prisma.join(sortedSeatIds)})
            AND "expiresAt" > ${now}
            AND "status" = 'ACTIVE'
          FOR UPDATE
        `;

        if (existingHolds.length > 0) {
          return {
            success: false,
            error: "One or more seats already have active holds",
          };
        }

        // 4. Create active holds
        const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
        const holdIds: string[] = [];

        for (const seatId of sortedSeatIds) {
          const hold = await tx.deskHold.create({
            data: {
              venueId,
              seatId,
              userId,
              status: "ACTIVE",
              expiresAt,
            },
          });
          holdIds.push(hold.id);
        }

        return { success: true, holdIds };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  });
}
