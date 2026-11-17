import { prisma } from "@/lib/prisma";

export const WEBHOOK_OUTBOX_MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const MIN_RETRY_DELAY_MS = 1_000;
const PROCESSING_LEASE_MS = 90_000;

/**
 * Full-jitter exponential backoff for a failed webhook dispatch.
 *
 * The deterministic part is the ceiling, `base * 2^(attempt - 1)` capped at 24
 * hours. The delay is then drawn uniformly from `[0, ceiling]` rather than
 * being pinned near it. When an endpoint that returned 503 recovers, every
 * event queued behind it becomes due at once; a fixed or narrowly bounded
 * backoff makes those retries arrive in the same second and re-trigger the
 * outage. Uniform sampling spreads them across the whole window, so the
 * expected burst size stays flat as the queue grows.
 *
 * The one-second floor keeps `random * ceiling` from rounding to zero, which
 * would mark a failed event due immediately and let a single worker run burn
 * through the attempt budget in milliseconds.
 */
export function computeWebhookRetryDelayMs(
  attempt: number,
  random: number = Math.random(),
): number {
  const attemptNumber = Number.isFinite(attempt) ? Math.floor(attempt) : 1;
  const safeAttempt = Math.max(1, attemptNumber);
  const ceiling = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** (safeAttempt - 1),
  );
  const unit = Number.isFinite(random)
    ? Math.min(1, Math.max(0, random))
    : Math.random();
  return Math.min(
    ceiling,
    Math.max(MIN_RETRY_DELAY_MS, Math.floor(unit * ceiling)),
  );
}

/**
 * Claims due events with compare-and-set updates. Concurrent workers can read
 * the same candidate, but only one can acquire its processing lease.
 */
export async function claimDueWebhookEvents(limit = 100, now = new Date()) {
  const candidates = await prisma.webhookOutboxEvent.findMany({
    where: {
      OR: [
        { state: "PENDING", nextAttemptAt: { lte: now } },
        {
          state: "PROCESSING",
          OR: [{ lockedUntil: { lte: now } }, { lockedUntil: null }],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(500, limit)),
  });

  const claimed = [];
  const lockedUntil = new Date(now.getTime() + PROCESSING_LEASE_MS);
  for (const candidate of candidates) {
    const where =
      candidate.state === "PENDING"
        ? {
            id: candidate.id,
            state: "PENDING",
            nextAttemptAt: { lte: now },
          }
        : {
            id: candidate.id,
            state: "PROCESSING",
            OR: [{ lockedUntil: { lte: now } }, { lockedUntil: null }],
          };

    const updated = await prisma.webhookOutboxEvent.updateMany({
      where,
      data: { state: "PROCESSING", lockedUntil },
    });
    if (updated.count === 1) claimed.push(candidate);
  }
  return claimed;
}
