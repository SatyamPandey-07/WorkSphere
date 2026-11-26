import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePrivateLeaderboardProver } from '../../core/zkp/ZeroKnowledgePrivateLeaderboardProver';

describe('ZeroKnowledgePrivateLeaderboardProver', () => {
  const lb = new ZeroKnowledgePrivateLeaderboardProver();

  it('proves descending confidential leaderboard ranking without disclosing any numeric score', () => {
    const records = [
      lb.commitScore('team-c', 410n),
      lb.commitScore('team-a', 890n),
      lb.commitScore('team-d', 220n),
      lb.commitScore('team-b', 650n),
    ];
    const ledger = new Map(records.map((r) => [r.participantId, r.commitment]));

    const proof = lb.proveDescendingRanking('q4-perf-ranking', records, 12);
    expect(proof.orderedParticipantIds).toEqual(['team-a', 'team-b', 'team-c', 'team-d']);
    expect(lb.verifyDescendingRanking(proof, ledger).valid).toBe(true);

    // Swapping two participants in the claimed order must fail
    const swapped = {
      ...proof,
      orderedParticipantIds: ['team-b', 'team-a', 'team-c', 'team-d'],
    };
    expect(lb.verifyDescendingRanking(swapped, ledger).valid).toBe(false);
  });

  it('proves threshold qualification above cutoff and round-trips JSON serialization', () => {
    const rec = lb.commitScore('dev-1', 750n);
    const qual = lb.proveThresholdQualification('qual-1', rec, 600n, 12);
    expect(lb.verifyThresholdQualification(qual, rec.commitment)).toBe(true);
    expect(lb.verifyThresholdQualification({ ...qual, minimumCutoff: 601n }, rec.commitment)).toBe(false);
    expect(() => lb.proveThresholdQualification('qual-fail', rec, 800n, 12)).toThrow();

    const json = lb.serializeQualificationProof(qual);
    const restored = lb.deserializeQualificationProof(json);
    expect(restored).toEqual(qual);
    expect(lb.verifyThresholdQualification(restored, rec.commitment)).toBe(true);
  });
});
