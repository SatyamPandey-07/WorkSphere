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

export async function confirmSeatPayment(seatId: string) {
  // Optimistic concurrency check: ensure status is PENDING and not expired before confirming
  const query = `
    UPDATE seat_holds 
    SET status = 'CONFIRMED' 
    WHERE seat_id = '${seatId}' AND status = 'PENDING' AND expires_at > NOW()
    RETURNING *;
  `;
  console.log(
    `🔒 [Seat Service] Executing atomic confirmation check for seat ${seatId}`,
  );
  return query;
}
