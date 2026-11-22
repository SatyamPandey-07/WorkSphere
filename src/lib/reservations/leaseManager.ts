 feat/redis-zkp-solana-desk-hold
import { randomUUID } from 'crypto';

export const DEFAULT_DESK_LEASE_TTL_MS = 120_000;

export type DeskReservationStatus = 'HELD' | 'CONFIRMED' | 'RELEASED';

export interface DeskLeaseRecord {
  deskId: string;
  slotWindow: string;
  proofHash: string;
  merkleRoot: string;
  ownerToken: string;
  status: DeskReservationStatus;
  acquiredAt: number;
  expiresAt: number;
  txSignature?: string;
}

export interface RedisLikeClient {
  set(
    key: string,
    value: string,
    mode?: 'NX',
    ttlMode?: 'PX',
    ttlMs?: number
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const COMPARE_AND_RELEASE_LUA = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return 0
end
local ok, decoded = pcall(cjson.decode, raw)
if ok and decoded and decoded["ownerToken"] == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export function buildDeskLeaseKey(deskId: string, slotWindow: string): string {
  return `worksphere:desk:lease:${deskId}:${slotWindow}`;
}

export class DeskLeaseManager {
  private readonly ttlMs: number;

  constructor(
    private readonly redis: RedisLikeClient,
    options: { ttlMs?: number } = {}
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_DESK_LEASE_TTL_MS;
  }

  async acquireLease(params: {
    deskId: string;
    slotWindow: string;
    proofHash: string;
    merkleRoot: string;
    now?: number;
  }): Promise<DeskLeaseRecord | null> {
    const now = params.now ?? Date.now();
    const key = buildDeskLeaseKey(params.deskId, params.slotWindow);
    const ownerToken = randomUUID();

    const record: DeskLeaseRecord = {
      deskId: params.deskId,
      slotWindow: params.slotWindow,
      proofHash: params.proofHash,
      merkleRoot: params.merkleRoot,
      ownerToken,
      status: 'HELD',
      acquiredAt: now,
      expiresAt: now + this.ttlMs,
    };

    const setResult = await this.redis.set(
      key,
      JSON.stringify(record),
      'NX',
      'PX',
      this.ttlMs
    );

    if (setResult !== 'OK') {
      return null;
    }

    return record;
  }

  async promoteToConfirmed(params: {
    deskId: string;
    slotWindow: string;
    ownerToken: string;
    txSignature: string;
    now?: number;
  }): Promise<DeskLeaseRecord | null> {
    const now = params.now ?? Date.now();
    const key = buildDeskLeaseKey(params.deskId, params.slotWindow);
    const raw = await this.redis.get(key);
    if (!raw) return null;

    const current = JSON.parse(raw) as DeskLeaseRecord;
    if (current.ownerToken !== params.ownerToken || current.expiresAt <= now) {
      return null;
    }

    const updated: DeskLeaseRecord = {
      ...current,
      status: 'CONFIRMED',
      txSignature: params.txSignature,
    };

    const remainingMs = Math.max(1_000, current.expiresAt - now);
    await this.redis.set(key, JSON.stringify(updated), undefined, 'PX', remainingMs);
    return updated;
  }

  async releaseLease(
    deskId: string,
    slotWindow: string,
    ownerToken: string
  ): Promise<boolean> {
    const key = buildDeskLeaseKey(deskId, slotWindow);
    const deleted = await this.redis.eval(COMPARE_AND_RELEASE_LUA, [key], [ownerToken]);
    return Number(deleted) === 1;
  }
}
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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

/** SQLSTATE / Prisma codes that are safe to retry with backoff. */
const RETRYABLE_CODES = new Set(["55P03", "40P01", "40001", "P2028", "P2034"]);

function isRetryableTransactionError(error: any): boolean {
  const code = error?.code ?? error?.meta?.code;
  if (code && RETRYABLE_CODES.has(code)) return true;

  const message = typeof error?.message === "string" ? error.message : "";
  return (
    message.includes("could not obtain lock") ||
    message.includes("deadlock detected") ||
    message.includes("serialization failure") ||
    message.includes("55P03") ||
    message.includes("40P01") ||
    message.includes("40001")
  );
}

/**
 * Execute an operation with exponential backoff and jitter on PostgreSQL
 * lock/serialization failures (55P03 / 40P01 / 40001) and the equivalent
 * Prisma P2034 / P2028 errors.
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
      if (isRetryableTransactionError(error) && attempt < maxRetries) {
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
          const hold = await (tx as any).deskHold.create({
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
 main
