import { prisma } from "@/lib/prisma";
import {
  MIN_SETTLEMENT_SAMPLE_SIZE,
  SETTLEMENT_CONFIDENCE_THRESHOLD,
} from "./consensusEngine";
import {
  aggregateWeightedVotes,
  calculateContributorWeight,
} from "./reputationEngine";

export const DEFAULT_AMENITY_DISPUTE_POLARIZATION_MARGIN = 10;
export const DEFAULT_AMENITY_DISPUTE_EXTENSION_MS = 24 * 60 * 60 * 1000;
const HIGH_REPUTATION_WEIGHT_THRESHOLD = 1.5;

export interface AmenityDisputeVote {
  userId: string;
  isUpvote: boolean;
  accurateVotes?: number;
}

export interface AmenityDisputeEvaluation {
  votes: AmenityDisputeVote[];
  escalated: boolean;
  settlementDeadline: Date | null;
  settlementDeferred: boolean;
}

function getDisputeConfiguration(): {
  polarizationMargin: number;
  extensionMs: number;
} {
  const polarizationMargin = Number(
    process.env.AMENITY_DISPUTE_POLARIZATION_MARGIN ??
      DEFAULT_AMENITY_DISPUTE_POLARIZATION_MARGIN,
  );
  const extensionMs = Number(
    process.env.AMENITY_DISPUTE_EXTENSION_MS ??
      DEFAULT_AMENITY_DISPUTE_EXTENSION_MS,
  );

  if (
    !Number.isFinite(polarizationMargin) ||
    polarizationMargin < 0 ||
    polarizationMargin > 50
  ) {
    throw new Error(
      "AMENITY_DISPUTE_POLARIZATION_MARGIN must be between 0 and 50",
    );
  }
  if (!Number.isSafeInteger(extensionMs) || extensionMs <= 0) {
    throw new Error("AMENITY_DISPUTE_EXTENSION_MS must be a positive integer");
  }

  return { polarizationMargin, extensionMs };
}

export function detectPolarizedAmenityVotes(
  votes: readonly AmenityDisputeVote[],
  polarizationMargin = DEFAULT_AMENITY_DISPUTE_POLARIZATION_MARGIN,
): boolean {
  if (
    !Number.isFinite(polarizationMargin) ||
    polarizationMargin < 0 ||
    polarizationMargin > 50
  ) {
    throw new Error("Polarization margin must be between 0 and 50");
  }

  if (votes.length < MIN_SETTLEMENT_SAMPLE_SIZE) return false;

  let hasHighReputationUpvote = false;
  let hasHighReputationDownvote = false;
  for (const vote of votes) {
    if (
      calculateContributorWeight({
        userId: vote.userId,
        accurateVotes: vote.accurateVotes,
      }) < HIGH_REPUTATION_WEIGHT_THRESHOLD
    ) {
      continue;
    }

    if (vote.isUpvote) hasHighReputationUpvote = true;
    else hasHighReputationDownvote = true;
  }

  if (!hasHighReputationUpvote || !hasHighReputationDownvote) return false;

  const weighted = aggregateWeightedVotes([...votes]);
  const weightedTotal = weighted.weightedUpvotes + weighted.weightedDownvotes;
  if (weightedTotal <= 0) return false;

  const leadingConfidence =
    (Math.max(weighted.weightedUpvotes, weighted.weightedDownvotes) /
      weightedTotal) *
    100;

  return (
    Math.abs(leadingConfidence - SETTLEMENT_CONFIDENCE_THRESHOLD) <=
    polarizationMargin
  );
}

export async function evaluateAmenityDispute(
  validationId: string,
  now = new Date(),
): Promise<AmenityDisputeEvaluation> {
  const validation = await prisma.amenityValidation.findUniqueOrThrow({
    where: { id: validationId },
    select: {
      venueId: true,
      amenity: true,
      disputeEscalatedAt: true,
      settlementDeadline: true,
    },
  });
  const storedVotes = await prisma.amenityVote.findMany({
    where: { validationId },
    select: { userId: true, isUpvote: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(storedVotes.map((vote) => vote.userId))] } },
    select: { id: true, accurateVotes: true },
  });
  const reputationByUserId = new Map(
    users.map((user) => [user.id, user.accurateVotes] as const),
  );
  const votes = storedVotes.map((vote) => ({
    ...vote,
    accurateVotes: reputationByUserId.get(vote.userId) ?? 0,
  }));
  const { polarizationMargin, extensionMs } = getDisputeConfiguration();

  let disputeEscalatedAt = validation.disputeEscalatedAt;
  let settlementDeadline = validation.settlementDeadline;

  if (
    !disputeEscalatedAt &&
    detectPolarizedAmenityVotes(votes, polarizationMargin)
  ) {
    const deadline = new Date(now.getTime() + extensionMs);
    await prisma.$transaction(async (tx) => {
      const claim = await tx.amenityValidation.updateMany({
        where: { id: validationId, disputeEscalatedAt: null },
        data: {
          disputeEscalatedAt: now,
          settlementDeadline: deadline,
        },
      });

      if (claim.count === 0) return;

      const stewards = await tx.user.findMany({
        where: { isAdmin: true },
        select: { id: true },
      });
      if (stewards.length === 0) return;

      await tx.pushNotificationLog.createMany({
        data: stewards.map(({ id }) => ({
          userId: id,
          venueId: validation.venueId,
          title: "Amenity vote dispute needs review",
          body: `Conflicting high-reputation votes were detected for ${validation.amenity}. The settlement window is extended for verification.`,
          status: "DELIVERED",
        })),
      });
    });

    const latest = await prisma.amenityValidation.findUniqueOrThrow({
      where: { id: validationId },
      select: {
        disputeEscalatedAt: true,
        settlementDeadline: true,
      },
    });
    disputeEscalatedAt = latest.disputeEscalatedAt;
    settlementDeadline = latest.settlementDeadline;
  }

  return {
    votes,
    escalated: disputeEscalatedAt !== null,
    settlementDeadline,
    settlementDeferred:
      settlementDeadline !== null && settlementDeadline.getTime() > now.getTime(),
  };
}
