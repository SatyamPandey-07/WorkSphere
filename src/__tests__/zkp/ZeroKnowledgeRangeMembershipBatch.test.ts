import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeRangeMembershipBatch, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeRangeMembershipBatch';

describe('ZeroKnowledgeRangeMembershipBatch', () => {
  const prover = new ZeroKnowledgeRangeMembershipBatch();

  it('proves hidden value belongs to a disjoint union of intervals without revealing which interval matched', () => {
    const allowed = [
      { min: 10n, max: 25n },
      { min: 100n, max: 150n },
      { min: 500n, max: 600n },
    ];

    const c1 = prover.commit(128n);
    const p1 = prover.proveMultiIntervalMembership(128n, c1.blinding, allowed, 'tier-elig-1');
    expect(p1.targetCommitment).toBe(c1.commitment);
    expect(prover.verifyMultiIntervalMembership(p1)).toBe(true);

    const c2 = prover.commit(10n); // exact lower boundary of interval 0
    const p2 = prover.proveMultiIntervalMembership(10n, c2.blinding, allowed, 'tier-elig-2');
    expect(prover.verifyMultiIntervalMembership(p2)).toBe(true);

    const c3 = prover.commit(600n); // exact upper boundary of interval 2
    const p3 = prover.proveMultiIntervalMembership(600n, c3.blinding, allowed, 'tier-elig-3');
    expect(prover.verifyMultiIntervalMembership(p3)).toBe(true);

    expect(prover.verifyBatch([p1, p2, p3])).toEqual({ allValid: true, failedIndices: [] });

    // Value in gap between intervals (50 is not in [10,25], [100,150], or [500,600]) MUST throw
    expect(() => prover.proveMultiIntervalMembership(50n, 12345n, allowed, 'gap-fail')).toThrow();

    // Tampered target commitment, challenge sum, or context MUST fail
    expect(prover.verifyMultiIntervalMembership({ ...p1, targetCommitment: (p1.targetCommitment * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(prover.verifyMultiIntervalMembership({ ...p1, context: 'wrong-ctx' })).toBe(false);
    const badBranches = p1.branches.map((b, i) => (i === 1 ? { ...b, eqResponse: (b.eqResponse + 1n) % SUBGROUP_Q } : b));
    expect(prover.verifyMultiIntervalMembership({ ...p1, branches: badBranches })).toBe(false);

    const json = JSON.parse(prover.serializeProof(p1)) as { intervalCount: number; context: string };
    expect(json.intervalCount).toBe(3);
    expect(json.context).toBe('tier-elig-1');
  });
});
