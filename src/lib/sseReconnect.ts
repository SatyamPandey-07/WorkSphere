export const SSE_RECONNECT_INITIAL_DELAY = 1_000;
export const SSE_RECONNECT_MAX_DELAY = 30_000;
export const SSE_RECONNECT_JITTER = 0.2;

/**
 * Calculates exponential reconnect delay with +/-20% jitter.
 * The final delay is capped at 30 seconds.
 */
export function getSseReconnectDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const baseDelay = Math.min(
    SSE_RECONNECT_INITIAL_DELAY * 2 ** Math.min(safeAttempt, 30),
    SSE_RECONNECT_MAX_DELAY,
  );

  const randomValue = Math.min(1, Math.max(0, random()));
  const jitterMultiplier =
    1 - SSE_RECONNECT_JITTER + randomValue * SSE_RECONNECT_JITTER * 2;

  return Math.min(
    SSE_RECONNECT_MAX_DELAY,
    Math.round(baseDelay * jitterMultiplier),
  );
}
