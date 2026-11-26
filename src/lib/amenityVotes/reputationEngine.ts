/**
 * src/lib/amenityVotes/reputationEngine.ts
 *
 * Bounded contributor reputation scoring and non-circular vote weighting (#10167).
 */

export const NEUTRAL_REPUTATION_WEIGHT = 1.0;
export const MIN_REPUTATION_WEIGHT = 0.5;
export const MAX_REPUTATION_WEIGHT = 2.5;

export interface ContributorReputationInput {
  userId: string;
  accurateVotes?: number;
  totalSettledVotes?: number;
}

/**
 * Calculates a bounded contributor reputation weight.
 * - Contributors without established history receive neutral weight (1.0).
 * - Maximum weight is strictly bounded to prevent a single account from dominating an amenity.
 * - Minimum weight is bounded to prevent complete disenfranchisement while discounting adversarial patterns.
 */
export function calculateContributorWeight(
  input: ContributorReputationInput,
): number {
  const accurate = input.accurateVotes ?? 0;
  if (accurate <= 0) {
    return NEUTRAL_REPUTATION_WEIGHT;
  }

  // Logarithmic scaling for diminishing returns on repeated voting
  const boost = Math.log10(1 + accurate) * 0.75;
  const rawWeight = NEUTRAL_REPUTATION_WEIGHT + boost;

  const clamped = Math.min(
    MAX_REPUTATION_WEIGHT,
    Math.max(MIN_REPUTATION_WEIGHT, rawWeight),
  );

  return Number(clamped.toFixed(3));
}

export interface WeightedVoteAggregation {
  weightedUpvotes: number;
  weightedDownvotes: number;
  effectiveSampleSize: number;
  rawUpvotes: number;
  rawDownvotes: number;
}

/**
 * Aggregates votes with contributor weights.
 */
export function aggregateWeightedVotes(
  votes: Array<{ userId: string; isUpvote: boolean; accurateVotes?: number }>,
): WeightedVoteAggregation {
  let weightedUpvotes = 0;
  let weightedDownvotes = 0;
  let rawUpvotes = 0;
  let rawDownvotes = 0;

  for (const v of votes) {
    const weight = calculateContributorWeight({
      userId: v.userId,
      accurateVotes: v.accurateVotes ?? 0,
    });

    if (v.isUpvote) {
      rawUpvotes += 1;
      weightedUpvotes += weight;
    } else {
      rawDownvotes += 1;
      weightedDownvotes += weight;
    }
  }

  const effectiveSampleSize = Number(
    (weightedUpvotes + weightedDownvotes).toFixed(2),
  );

  return {
    weightedUpvotes: Number(weightedUpvotes.toFixed(2)),
    weightedDownvotes: Number(weightedDownvotes.toFixed(2)),
    effectiveSampleSize,
    rawUpvotes,
    rawDownvotes,
  };
}
