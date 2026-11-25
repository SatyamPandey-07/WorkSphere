import {
  getLockKey,
  getSeatWebLock,
  releaseSeatWebLock,
} from "@/lib/locks/seatHoldLock";

/**
 * Converts an explicit UTC/offset timestamp into epoch milliseconds.
 *
 * Date and epoch inputs are already absolute. ISO strings must include Z or
 * an explicit numeric offset; naive local wall-clock strings are rejected
 * because their meaning is ambiguous at daylight-saving transitions.
 */
function toSeatHoldEpochMs(
  value: Date | number | string,
  fieldName: "startAt" | "endAt",
): number {
  let epochMs: number;

  if (value instanceof Date) {
    epochMs = value.getTime();
  } else if (typeof value === "number") {
    epochMs = value;
  } else if (
    typeof value === "string" &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  ) {
    epochMs = Date.parse(value);
  } else {
    throw new TypeError(
      `${fieldName} must be a Date, epoch-millisecond number, or ISO timestamp with an explicit timezone.`,
    );
  }

  if (!Number.isFinite(epochMs)) {
    throw new RangeError(`${fieldName} is not a valid timestamp.`);
  }
  return epochMs;
}

/**
 * Calculates the actual elapsed seat-hold duration using absolute UTC epoch
 * timestamps. Never subtract local getHours()/getMinutes() values: DST gaps and
 * repeated hours make wall-clock arithmetic incorrect.
 */
export function calculateSeatHoldDurationMs(
  startAt: Date | number | string,
  endAt: Date | number | string,
): number {
  const startEpochMs = toSeatHoldEpochMs(startAt, "startAt");
  const endEpochMs = toSeatHoldEpochMs(endAt, "endAt");
  const durationMs = endEpochMs - startEpochMs;

  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new RangeError("Seat-hold end time must be after its start time.");
  }
  return durationMs;
}

/**
 * Produces the absolute expiry instant for a seat hold from a confirmed
 * interval. Returning epoch milliseconds keeps countdown/lock TTL calculations
 * independent of the process timezone and DST offset changes.
 */
export function calculateSeatHoldExpiryMs(
  startAt: Date | number | string,
  endAt: Date | number | string,
): number {
  calculateSeatHoldDurationMs(startAt, endAt);
  return toSeatHoldEpochMs(endAt, "endAt");
}

/**
 * How long a claimed checkout protects the hold from expiring. The hold key
 * TTL is raised to at least this value for the duration of the claim.
 */
export const SEAT_CHECKOUT_GRACE_MS = 30_000;

export const SEAT_CHECKOUT_TRANSACTION_TIMEOUT_MS = 10_000;

/**
 * Atomically claims a seat hold for checkout.
 *
 * KEYS[1] = hold lock key, KEYS[2] = checkout marker key
 * ARGV[1] = userId, ARGV[2] = grace period in milliseconds
 *
 * Returns 1 when claimed, 0 when the hold is missing, -1 when another user
 * owns it, and -2 when this user already has a checkout in progress. A claim
 * raises the hold TTL to at least the grace period, so expiry cannot remove
 * the hold while the reservation is being persisted.
 */
export const SEAT_HOLD_CHECKOUT_CLAIM_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local ok, decoded = pcall(cjson.decode, current)
if not ok or type(decoded) ~= 'table' or decoded.userId ~= ARGV[1] then
  return -1
end
local claimed = redis.call('SET', KEYS[2], ARGV[1], 'NX', 'PX', tonumber(ARGV[2]))
if not claimed then return -2 end
local pttl = redis.call('PTTL', KEYS[1])
if pttl >= 0 and pttl < tonumber(ARGV[2]) then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return 1
`;

/**
 * Atomic compare-and-delete of the hold and its checkout marker. Only the
 * recorded holder can remove the hold. Returns 1 when the hold was deleted.
 *
 * KEYS[1] = hold lock key, KEYS[2] = checkout marker key, ARGV[1] = userId
 */
export const SEAT_HOLD_FINALIZE_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('DEL', KEYS[2])
  return 0
end
local ok, decoded = pcall(cjson.decode, current)
if ok and type(decoded) == 'table' and decoded.userId == ARGV[1] then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
return 0
`;

/** Clears the checkout marker after a failed attempt so the user can retry. */
export const SEAT_HOLD_CHECKOUT_ABORT_LUA = `
local marker = redis.call('GET', KEYS[2])
if marker == ARGV[1] then
  redis.call('DEL', KEYS[2])
  return 1
end
return 0
`;

export function getSeatCheckoutMarkerKey(
  venueId: string,
  seatId: string,
): string {
  return `seat:checkout:${venueId}:${seatId}`;
}

export interface SeatHoldRedis {
  eval(
    script: string,
    keys: string[],
    args: (string | number)[],
  ): Promise<unknown>;
}

export interface SeatHoldTransactionRunner<Tx> {
  $transaction<R>(
    fn: (tx: Tx) => Promise<R>,
    options?: {
      isolationLevel?: "Serializable";
      maxWait?: number;
      timeout?: number;
    },
  ): Promise<R>;
}

export interface ConfirmSeatPaymentDeps<Tx> {
  /** Defaults to the shared Redis client. `null` uses the in-memory fallback. */
  redis?: SeatHoldRedis | null;
  /** Defaults to the shared Prisma client. */
  db?: SeatHoldTransactionRunner<Tx>;
  checkoutGraceMs?: number;
}

export interface ConfirmSeatPaymentInput<Tx, T> {
  venueId: string;
  seatId: string;
  userId: string;
  /**
   * Creates the permanent reservation. Runs inside the interactive
   * transaction, so everything it writes commits or rolls back together.
   */
  persistReservation: (tx: Tx) => Promise<T>;
}

export type ConfirmSeatPaymentResult<T> =
  | {
      status: "CONFIRMED";
      reservation: T;
      /** False when the hold key was already gone. The reservation still stands. */
      holdReleased: boolean;
    }
  | { status: "HOLD_LOST"; reason: "MISSING" | "NOT_OWNER" }
  | { status: "IN_PROGRESS" };

async function resolveDefaultRedis(): Promise<SeatHoldRedis | null> {
  const { getRedis } = await import("@/lib/redis");
  const client = getRedis();
  if (!client) return null;
  return {
    eval: (script, keys, args) => client.eval(script, keys, args),
  };
}

async function resolveDefaultDb<Tx>(): Promise<SeatHoldTransactionRunner<Tx>> {
  const { prisma } = await import("@/lib/prisma");
  return prisma as unknown as SeatHoldTransactionRunner<Tx>;
}

/**
 * Converts a paid seat hold into a permanent reservation without racing the
 * hold expiry.
 *
 * 1. Claim the hold with an atomic Redis script that checks ownership and
 *    extends the hold TTL, so expiry cannot sweep it mid checkout.
 * 2. Persist the reservation in one serializable interactive transaction.
 * 3. Release the hold with an atomic compare-and-delete that only the holder
 *    can pass. The booking is already committed at this point, so a hold that
 *    expired in the meantime is reported through `holdReleased` and never
 *    thrown as an expiration error.
 *
 * A hold that is gone or owned by someone else returns `HOLD_LOST` without
 * writing anything, so the caller can refund the payment.
 */
export async function confirmSeatPayment<Tx = unknown, T = unknown>(
  input: ConfirmSeatPaymentInput<Tx, T>,
  deps: ConfirmSeatPaymentDeps<Tx> = {},
): Promise<ConfirmSeatPaymentResult<T>> {
  const { venueId, seatId, userId, persistReservation } = input;
  if (!venueId || !seatId || !userId) {
    throw new TypeError("venueId, seatId and userId are required.");
  }

  const redis =
    deps.redis === undefined ? await resolveDefaultRedis() : deps.redis;
  const graceMs = deps.checkoutGraceMs ?? SEAT_CHECKOUT_GRACE_MS;
  const lockKey = getLockKey(venueId, seatId);
  const markerKey = getSeatCheckoutMarkerKey(venueId, seatId);

  // 1. Claim
  if (redis) {
    const claim = Number(
      await redis.eval(
        SEAT_HOLD_CHECKOUT_CLAIM_LUA,
        [lockKey, markerKey],
        [userId, graceMs],
      ),
    );
    if (claim === 0) return { status: "HOLD_LOST", reason: "MISSING" };
    if (claim === -1) return { status: "HOLD_LOST", reason: "NOT_OWNER" };
    if (claim === -2) return { status: "IN_PROGRESS" };
  } else {
    // In memory fallback for environments without Redis (local development).
    const lock = await getSeatWebLock(venueId, seatId);
    if (!lock) return { status: "HOLD_LOST", reason: "MISSING" };
    if (lock.userId !== userId) {
      return { status: "HOLD_LOST", reason: "NOT_OWNER" };
    }
  }

  // 2. Persist
  const db = deps.db ?? (await resolveDefaultDb<Tx>());
  let reservation: T;
  try {
    reservation = await db.$transaction((tx) => persistReservation(tx), {
      isolationLevel: "Serializable",
      timeout: SEAT_CHECKOUT_TRANSACTION_TIMEOUT_MS,
    });
  } catch (error) {
    if (redis) {
      // Let the holder retry. The hold keeps its extended TTL.
      await redis
        .eval(SEAT_HOLD_CHECKOUT_ABORT_LUA, [lockKey, markerKey], [userId])
        .catch(() => undefined);
    }
    throw error;
  }

  // 3. Release. The reservation is committed, so nothing below may fail the call.
  let holdReleased = false;
  try {
    if (redis) {
      holdReleased =
        Number(
          await redis.eval(
            SEAT_HOLD_FINALIZE_LUA,
            [lockKey, markerKey],
            [userId],
          ),
        ) === 1;
    } else {
      holdReleased = await releaseSeatWebLock(venueId, seatId, userId);
    }
  } catch (error) {
    console.warn("[SeatHold] Hold release failed after commit:", error);
  }

  return { status: "CONFIRMED", reservation, holdReleased };
}
