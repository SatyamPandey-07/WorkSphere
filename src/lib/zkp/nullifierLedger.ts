import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

/**
 * Epoch-scoped nullifier ledger for anonymous venue check-ins (#7390).
 *
 * Uses Redis as the primary ledger when configured (atomic SET NX is the
 * double-spend guard) and falls back to PostgreSQL's unique constraint on
 * [nullifierHash, epoch] when Redis is unavailable.
 */

export interface VenueNullifierClaim {
  nullifierHash: string;
  epoch: number;
  venueId: string;
}

export type VenueNullifierClaimResult = "claimed" | "duplicate";

const NULLIFIER_KEY_PREFIX = "worksphere:zkp:venue-checkin-nullifier";
const DEFAULT_EPOCH_TTL_SECONDS = 60 * 60 * 24 * 32;

function ledgerKey(nullifierHash: string, epoch: number): string {
  return `${NULLIFIER_KEY_PREFIX}:${epoch}:${nullifierHash}`;
}

function secondsUntilEpochEnds(epoch: number): number {
  const now = Date.now();
  const epochEndsAt = Date.UTC(epoch + 1, 0, 1);
  const seconds = Math.ceil((epochEndsAt - now) / 1000);
  return seconds > 0 ? seconds : DEFAULT_EPOCH_TTL_SECONDS;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "P2002" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("Unique constraint"))
  );
}

export async function isVenueNullifierSpent(
  nullifierHash: string,
  epoch: number,
): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const exists = await redis.exists(ledgerKey(nullifierHash, epoch));
      return exists > 0;
    } catch {
      // Redis unavailable — fall through to PostgreSQL.
    }
  }

  const existing = await prisma.venueCheckInNullifier.findUnique({
    where: { nullifierHash_epoch: { nullifierHash, epoch } },
    select: { id: true },
  });

  return existing !== null;
}

/**
 * Atomically claim a nullifier for the given epoch.
 * Returns "duplicate" when the nullifier has already been used in that epoch.
 */
export async function claimVenueNullifier(
  claim: VenueNullifierClaim,
): Promise<VenueNullifierClaimResult> {
  const { nullifierHash, epoch, venueId } = claim;

  const redis = getRedis();
  if (redis) {
    try {
      const result = await redis.set(
        ledgerKey(nullifierHash, epoch),
        venueId,
        { nx: true, ex: secondsUntilEpochEnds(epoch) },
      );
      return result === null ? "duplicate" : "claimed";
    } catch {
      // Redis unavailable — fall through to PostgreSQL.
    }
  }

  try {
    await prisma.venueCheckInNullifier.create({
      data: { nullifierHash, epoch, venueId },
    });
    return "claimed";
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return "duplicate";
    }
    throw error;
  }
}
