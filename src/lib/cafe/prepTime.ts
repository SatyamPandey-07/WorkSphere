/** Extra minutes added to the estimate for each order already in the barista queue. */
export const QUEUE_MINUTES_PER_ORDER = 2;

/**
 * Estimated preparation time: the order's own prep time plus
 * QUEUE_MINUTES_PER_ORDER for every ticket ahead of it.
 * Negative or non-finite inputs are treated as 0.
 */
export function estimatePrepMinutes(
  basePrepMinutes: number,
  queueLength: number,
): number {
  const base = Number.isFinite(basePrepMinutes)
    ? Math.max(0, basePrepMinutes)
    : 0;
  const queue = Number.isFinite(queueLength)
    ? Math.max(0, Math.floor(queueLength))
    : 0;
  return base + queue * QUEUE_MINUTES_PER_ORDER;
}

/**
 * Whole minutes left until `readyAtMs`, rounded up so the display never shows
 * 0 while time remains. Returns 0 once the time has passed or for invalid input.
 */
export function minutesRemaining(readyAtMs: number, nowMs: number): number {
  if (!Number.isFinite(readyAtMs) || !Number.isFinite(nowMs)) return 0;
  const diffMs = readyAtMs - nowMs;
  return diffMs <= 0 ? 0 : Math.ceil(diffMs / 60_000);
}

/** Human-readable countdown label, e.g. "Ready in ~4 mins". */
export function formatReadyIn(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "Ready any moment";
  if (minutes === 1) return "Ready in ~1 min";
  return `Ready in ~${minutes} mins`;
}
