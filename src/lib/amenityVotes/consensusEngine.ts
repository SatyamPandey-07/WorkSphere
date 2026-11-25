/**
 * src/lib/amenityVotes/consensusEngine.ts
 *
 * Statistical consensus engine with Wilson-score interval confidence modeling,
 * delayed adjudication lifecycle, settlement snapshot hashing, and aggregate reconciliation (#10167).
 */

import { aggregateWeightedVotes, WeightedVoteAggregation } from "./reputationEngine";

export const CONSENSUS_RULE_VERSION = "2.0.0-reputation-bayes";
export const MIN_SETTLEMENT_SAMPLE_SIZE = 5;
export const SETTLEMENT_CONFIDENCE_THRESHOLD = 80;
export const VERIFIED_EXPLORER_THRESHOLD = 10;

export type ConsensusLifecycleState =
  | "PROVISIONAL"
  | "ELIGIBLE_FOR_SETTLEMENT"
  | "SETTLED"
  | "REOPENED";

export interface SettlementSnapshot {
  validationId: string;
  snapshotDigest: string;
  voteCount: number;
  weightedUpvotes: number;
  weightedDownvotes: number;
  consensusDirection: "upvote" | "downvote" | "inconclusive";
  ruleVersion: string;
  settledAt: number;
}

export interface AmenityConsensusEvaluation {
  state: ConsensusLifecycleState;
  rawConfidenceScore: number;
  statisticalConfidence: number;
  probability: number;
  effectiveSampleSize: number;
  settlementEligible: boolean;
  consensusDirection: "upvote" | "downvote" | "inconclusive";
  ruleVersion: string;
  snapshot?: SettlementSnapshot;
}

export interface StoredSettlementMetadata {
  snapshotDigest: string;
  consensusDirection: "upvote" | "downvote" | "inconclusive";
  ruleVersion: string;
  settledAt: number;
}

// In-memory settlement snapshot store for tracking historical settlements
const settledSnapshots = new Map<string, StoredSettlementMetadata>();

/**
 * Computes Wilson score interval (lower bound, center, upper bound)
 * for binomial proportions under 95% confidence (z = 1.96).
 * Wilson score interval penalizes small sample sizes rigorously.
 */
export function computeWilsonScoreInterval(
  positive: number,
  total: number,
  z = 1.96,
): { lower: number; center: number; upper: number } {
  if (total <= 0) {
    return { lower: 0, center: 0.5, upper: 1 };
  }

  const p = positive / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const halfWidth =
    (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;

  return {
    lower: Number(Math.max(0, center - halfWidth).toFixed(4)),
    center: Number(center.toFixed(4)),
    upper: Number(Math.min(1, center + halfWidth).toFixed(4)),
  };
}

/**
 * Computes a deterministic hash/digest for a vote set snapshot.
 */
export function computeVoteSetSnapshotDigest(
  validationId: string,
  votes: Array<{ userId: string; isUpvote: boolean }>,
): string {
  const sortedVotes = [...votes].sort((a, b) => a.userId.localeCompare(b.userId));
  const serialized = sortedVotes
    .map((v) => `${v.userId}:${v.isUpvote ? "1" : "0"}`)
    .join(";");
  
  // Deterministic DJB2-like compact digest for tests/runtime
  let hash = 5381;
  const str = `${validationId}|${serialized}|${CONSENSUS_RULE_VERSION}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return `snap_${(hash >>> 0).toString(16)}_${votes.length}`;
}

/**
 * Evaluates the full consensus state for an amenity validation.
 */
export function evaluateAmenityConsensus(
  validationId: string,
  votes: Array<{ userId: string; isUpvote: boolean; accurateVotes?: number }>,
): AmenityConsensusEvaluation {
  const weighted: WeightedVoteAggregation = aggregateWeightedVotes(votes);
  const totalRaw = weighted.rawUpvotes + weighted.rawDownvotes;

  const rawConfidenceScore =
    totalRaw > 0 ? Math.round((weighted.rawUpvotes / totalRaw) * 100) : 100;

  // Wilson score lower bound on weighted upvotes
  const effectiveTotal = weighted.weightedUpvotes + weighted.weightedDownvotes;
  const wilson = computeWilsonScoreInterval(
    weighted.weightedUpvotes,
    effectiveTotal,
  );

  const statisticalConfidence = Math.round(wilson.lower * 100);
  const probability =
    effectiveTotal > 0
      ? Number((weighted.weightedUpvotes / effectiveTotal).toFixed(4))
      : 0.5;

  let consensusDirection: "upvote" | "downvote" | "inconclusive" = "inconclusive";
  if (rawConfidenceScore >= SETTLEMENT_CONFIDENCE_THRESHOLD) {
    consensusDirection = "upvote";
  } else if (rawConfidenceScore <= 100 - SETTLEMENT_CONFIDENCE_THRESHOLD) {
    consensusDirection = "downvote";
  }

  const existingSettlement = settledSnapshots.get(validationId);
  const currentSnapshotDigest = computeVoteSetSnapshotDigest(validationId, votes);

  let state: ConsensusLifecycleState = "PROVISIONAL";

  if (existingSettlement) {
    if (existingSettlement.snapshotDigest === currentSnapshotDigest) {
      state = "SETTLED";
    } else if (
      existingSettlement.consensusDirection !== consensusDirection ||
      rawConfidenceScore < SETTLEMENT_CONFIDENCE_THRESHOLD
    ) {
      // Material shift or loss of consensus reopens settled amenity
      state = "REOPENED";
    } else {
      state = "ELIGIBLE_FOR_SETTLEMENT";
    }
  } else if (
    totalRaw >= MIN_SETTLEMENT_SAMPLE_SIZE &&
    rawConfidenceScore >= SETTLEMENT_CONFIDENCE_THRESHOLD
  ) {
    state = "ELIGIBLE_FOR_SETTLEMENT";
  } else {
    state = "PROVISIONAL";
  }

  const settlementEligible =
    state === "ELIGIBLE_FOR_SETTLEMENT" || state === "REOPENED";

  const snapshot: SettlementSnapshot | undefined = settlementEligible
    ? {
        validationId,
        snapshotDigest: currentSnapshotDigest,
        voteCount: totalRaw,
        weightedUpvotes: weighted.weightedUpvotes,
        weightedDownvotes: weighted.weightedDownvotes,
        consensusDirection,
        ruleVersion: CONSENSUS_RULE_VERSION,
        settledAt: Date.now(),
      }
    : undefined;

  return {
    state,
    rawConfidenceScore,
    statisticalConfidence,
    probability,
    effectiveSampleSize: weighted.effectiveSampleSize,
    settlementEligible,
    consensusDirection,
    ruleVersion: CONSENSUS_RULE_VERSION,
    snapshot,
  };
}

/**
 * Records a formal settlement snapshot in the settlement registry.
 */
export function recordSettlement(
  snapshot: SettlementSnapshot,
): void {
  settledSnapshots.set(snapshot.validationId, {
    snapshotDigest: snapshot.snapshotDigest,
    consensusDirection: snapshot.consensusDirection,
    ruleVersion: snapshot.ruleVersion,
    settledAt: snapshot.settledAt,
  });
}

/**
 * Reconciles authoritative vote records against cached upvote/downvote counters.
 */
export function reconcileAuthoritativeVotes(
  validationId: string,
  votes: Array<{ isUpvote: boolean }>,
  currentUpvotes: number,
  currentDownvotes: number,
): {
  reconciledUpvotes: number;
  reconciledDownvotes: number;
  hasDiscrepancy: boolean;
} {
  let reconciledUpvotes = 0;
  let reconciledDownvotes = 0;

  for (const v of votes) {
    if (v.isUpvote) reconciledUpvotes++;
    else reconciledDownvotes++;
  }

  const hasDiscrepancy =
    reconciledUpvotes !== currentUpvotes ||
    reconciledDownvotes !== currentDownvotes;

  return {
    reconciledUpvotes,
    reconciledDownvotes,
    hasDiscrepancy,
  };
}

/**
 * Clears settlement snapshots (used in test teardown).
 */
export function clearSettlementRegistries(): void {
  settledSnapshots.clear();
}
