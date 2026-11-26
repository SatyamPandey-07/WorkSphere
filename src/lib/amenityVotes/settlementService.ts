import { prisma } from "@/lib/prisma";
import { invalidateXpLeaderboard } from "@/lib/leaderboards/xpLeaderboard";
import {
  evaluateAmenityConsensus,
  recordSettlement,
  AmenityConsensusEvaluation,
  VERIFIED_EXPLORER_THRESHOLD,
} from "./consensusEngine";
import { evaluateAmenityDispute } from "./disputeEscalation";

export async function trackAccurateContributions(
  validationId: string,
): Promise<AmenityConsensusEvaluation> {
  const dispute = await evaluateAmenityDispute(validationId);
  const evaluation = evaluateAmenityConsensus(validationId, dispute.votes);

  if (dispute.settlementDeferred) {
    return {
      ...evaluation,
      state: "PROVISIONAL",
      settlementEligible: false,
      disputeEscalated: true,
      settlementDeadline: dispute.settlementDeadline?.getTime(),
      snapshot: undefined,
    };
  }

  if (!evaluation.settlementEligible || !evaluation.snapshot) {
    return {
      ...evaluation,
      disputeEscalated: dispute.escalated,
      settlementDeadline: dispute.settlementDeadline?.getTime(),
    };
  }

  const consensusIsUpvote = evaluation.consensusDirection === "upvote";
  if (evaluation.consensusDirection === "inconclusive") {
    return {
      ...evaluation,
      disputeEscalated: dispute.escalated,
      settlementDeadline: dispute.settlementDeadline?.getTime(),
    };
  }

  const alreadyCredited = await prisma.userBadge.findMany({
    where: { badgeType: `accurate_${validationId}` },
    select: { userId: true },
  });
  const creditedUserIds = new Set(alreadyCredited.map((badge) => badge.userId));

  for (const vote of dispute.votes) {
    if (vote.isUpvote !== consensusIsUpvote) continue;
    if (creditedUserIds.has(vote.userId)) continue;

    await prisma.userBadge.create({
      data: {
        userId: vote.userId,
        badgeType: `accurate_${validationId}`,
      },
    });

    const user = await prisma.user.update({
      where: { id: vote.userId },
      data: { accurateVotes: { increment: 1 } },
    });

    if (user.accurateVotes >= VERIFIED_EXPLORER_THRESHOLD) {
      await prisma.userBadge.upsert({
        where: {
          userId_badgeType: {
            userId: vote.userId,
            badgeType: "verified_explorer",
          },
        },
        update: {},
        create: { userId: vote.userId, badgeType: "verified_explorer" },
      });
    }
    await invalidateXpLeaderboard();
  }

  recordSettlement(evaluation.snapshot);

  return {
    ...evaluation,
    disputeEscalated: dispute.escalated,
    settlementDeadline: dispute.settlementDeadline?.getTime(),
  };
}
