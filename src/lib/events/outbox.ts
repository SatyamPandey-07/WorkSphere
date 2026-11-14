import { prisma } from "@/lib/prisma";

export const WEBHOOK_OUTBOX_MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const PROCESSING_LEASE_MS = 90_000;

export function computeWebhookRetryDelayMs(
  attempt: number,
  random: number = Math.random(),
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const base = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** (safeAttempt - 1),
  );
  const safeRandom = Math.max(0, Math.min(1, random));
  return Math.min(
    MAX_RETRY_DELAY_MS,
    Math.round(base * (0.75 + safeRandom * 0.5)),
  );
}

/**
 * Claims due events with compare-and-set updates. Concurrent workers can read
 * the same candidate, but only one can acquire its processing lease.
 */
export async function claimDueWebhookEvents(
  limit = 100,
  now = new Date(),
) {
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
