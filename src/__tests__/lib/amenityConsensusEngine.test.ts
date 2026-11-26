/**
 * src/__tests__/lib/amenityConsensusEngine.test.ts
 *
 * Verifies Bayesian/Wilson statistical confidence, bounded contributor reputation,
 * settlement snapshots, consensus lifecycle (PROVISIONAL -> SETTLED -> REOPENED),
 * and vote counter reconciliation (#10167).
 */

import {
  computeWilsonScoreInterval,
  computeVoteSetSnapshotDigest,
  evaluateAmenityConsensus,
  recordSettlement,
  reconcileAuthoritativeVotes,
  clearSettlementRegistries,
} from "@/lib/amenityVotes/consensusEngine";
import {
  calculateContributorWeight,
  aggregateWeightedVotes,
  NEUTRAL_REPUTATION_WEIGHT,
  MAX_REPUTATION_WEIGHT,
  MIN_REPUTATION_WEIGHT,
} from "@/lib/amenityVotes/reputationEngine";

describe("Amenity Statistical Consensus & Reputation Engine (#10167)", () => {
  beforeEach(() => {
    clearSettlementRegistries();
  });

  describe("Wilson Score Interval Statistical Confidence", () => {
    it("penalizes small sample size: 1 upvote yields low confidence despite 100% raw score", () => {
      const smallSample = computeWilsonScoreInterval(1, 1);
      const largeSample = computeWilsonScoreInterval(20, 20);

      // Raw proportion is 1.0 in both cases, but statistical lower bound differs drastically
      expect(smallSample.lower).toBeLessThan(0.25);
      expect(largeSample.lower).toBeGreaterThan(0.8);
    });

    it("evaluates balanced 50/50 vote distribution centered at 0.5", () => {
      const interval = computeWilsonScoreInterval(10, 20);
      expect(interval.center).toBe(0.5);
      expect(interval.lower).toBeLessThan(0.5);
      expect(interval.upper).toBeGreaterThan(0.5);
    });
  });

  describe("Bounded Contributor Reputation Weighting", () => {
    it("assigns neutral weight 1.0 to contributors without prior history", () => {
      const weight = calculateContributorWeight({ userId: "newbie", accurateVotes: 0 });
      expect(weight).toBe(NEUTRAL_REPUTATION_WEIGHT);
    });

    it("bounds maximum reputation weight strictly to prevent dominance", () => {
      const highAccurate = calculateContributorWeight({
        userId: "veteran",
        accurateVotes: 10000,
      });
      expect(highAccurate).toBeLessThanOrEqual(MAX_REPUTATION_WEIGHT);
      expect(highAccurate).toBeGreaterThan(1.5);
    });

    it("guarantees weights stay within [MIN_REPUTATION_WEIGHT, MAX_REPUTATION_WEIGHT]", () => {
      expect(calculateContributorWeight({ userId: "u", accurateVotes: -5 })).toBeGreaterThanOrEqual(
        MIN_REPUTATION_WEIGHT,
      );
    });

    it("aggregates votes with contributor weights deterministically", () => {
      const votes = [
        { userId: "u1", isUpvote: true, accurateVotes: 0 }, // weight 1.0
        { userId: "u2", isUpvote: true, accurateVotes: 10 }, // weight > 1.0
        { userId: "u3", isUpvote: false, accurateVotes: 0 }, // weight 1.0
      ];
      const aggregated = aggregateWeightedVotes(votes);
      expect(aggregated.rawUpvotes).toBe(2);
      expect(aggregated.rawDownvotes).toBe(1);
      expect(aggregated.weightedUpvotes).toBeGreaterThan(2.0);
      expect(aggregated.weightedDownvotes).toBe(1.0);
    });
  });

  describe("Consensus Lifecycle: Provisional -> Eligible -> Settled -> Reopened", () => {
    const valId = "val-wifi-123";

    it("marks consensus PROVISIONAL when vote count is below settlement threshold", () => {
      const votes = [
        { userId: "u1", isUpvote: true },
        { userId: "u2", isUpvote: true },
      ];
      const evalResult = evaluateAmenityConsensus(valId, votes);
      expect(evalResult.state).toBe("PROVISIONAL");
      expect(evalResult.settlementEligible).toBe(false);
    });

    it("transitions to ELIGIBLE_FOR_SETTLEMENT when threshold is reached", () => {
      const votes = [
        { userId: "u1", isUpvote: true },
        { userId: "u2", isUpvote: true },
        { userId: "u3", isUpvote: true },
        { userId: "u4", isUpvote: true },
        { userId: "u5", isUpvote: true },
      ];
      const evalResult = evaluateAmenityConsensus(valId, votes);
      expect(evalResult.state).toBe("ELIGIBLE_FOR_SETTLEMENT");
      expect(evalResult.settlementEligible).toBe(true);
      expect(evalResult.consensusDirection).toBe("upvote");
      expect(evalResult.snapshot).toBeDefined();
    });

    it("tracks SETTLED state after recording settlement snapshot", () => {
      const votes = [
        { userId: "u1", isUpvote: true },
        { userId: "u2", isUpvote: true },
        { userId: "u3", isUpvote: true },
        { userId: "u4", isUpvote: true },
        { userId: "u5", isUpvote: true },
      ];
      const eval1 = evaluateAmenityConsensus(valId, votes);
      expect(eval1.snapshot).toBeDefined();
      recordSettlement(eval1.snapshot!);

      // Re-evaluating with identical votes returns SETTLED
      const eval2 = evaluateAmenityConsensus(valId, votes);
      expect(eval2.state).toBe("SETTLED");
    });

    it("transitions to REOPENED when subsequent voting destroys consensus", () => {
      const votes = [
        { userId: "u1", isUpvote: true },
        { userId: "u2", isUpvote: true },
        { userId: "u3", isUpvote: true },
        { userId: "u4", isUpvote: true },
        { userId: "u5", isUpvote: true },
      ];
      const eval1 = evaluateAmenityConsensus(valId, votes);
      recordSettlement(eval1.snapshot!);

      // Several downvotes arrive shifting consensus
      const expandedVotes = [
        ...votes,
        { userId: "u6", isUpvote: false },
        { userId: "u7", isUpvote: false },
        { userId: "u8", isUpvote: false },
        { userId: "u9", isUpvote: false },
      ];
      const eval2 = evaluateAmenityConsensus(valId, expandedVotes);
      expect(eval2.state).toBe("REOPENED");
    });
  });

  describe("Snapshot Digest & Authoritative Vote Reconciliation", () => {
    it("snapshot digest is invariant to voter ordering but sensitive to vote changes", () => {
      const votesA = [
        { userId: "alice", isUpvote: true },
        { userId: "bob", isUpvote: false },
      ];
      const votesB = [
        { userId: "bob", isUpvote: false },
        { userId: "alice", isUpvote: true },
      ];
      const votesC = [
        { userId: "alice", isUpvote: false },
        { userId: "bob", isUpvote: false },
      ];

      const digestA = computeVoteSetSnapshotDigest("val-1", votesA);
      const digestB = computeVoteSetSnapshotDigest("val-1", votesB);
      const digestC = computeVoteSetSnapshotDigest("val-1", votesC);

      expect(digestA).toBe(digestB);
      expect(digestA).not.toBe(digestC);
    });

    it("reconciles cached counters against authoritative source votes", () => {
      const authoritativeVotes = [
        { isUpvote: true },
        { isUpvote: true },
        { isUpvote: false },
      ];
      // Suppose cached counter was corrupted: upvotes=5, downvotes=0
      const rec = reconcileAuthoritativeVotes("val-1", authoritativeVotes, 5, 0);

      expect(rec.hasDiscrepancy).toBe(true);
      expect(rec.reconciledUpvotes).toBe(2);
      expect(rec.reconciledDownvotes).toBe(1);
    });
  });
});
