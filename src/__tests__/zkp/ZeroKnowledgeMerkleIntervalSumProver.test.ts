import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleIntervalSumProver } from '../../core/zkp/ZeroKnowledgeMerkleIntervalSumProver';

describe('ZeroKnowledgeMerkleIntervalSumProver', () => {
  it('verifies O(log N) interval sum proofs across arbitrary ranges and rejects tampered claims', () => {
    const prover = new ZeroKnowledgeMerkleIntervalSumProver();
    const values = [100n, 250n, 75n, 420n, 310n, 90n, 640n, 155n, 50n, 210n];
    prover.buildTree(values.map((value, i) => ({ label: `bucket-${i}`, value })));

    const fullProof = prover.proveIntervalSum(0, values.length - 1, 'q4-audit');
    expect(fullProof.claimedSum).toBe(2300n);
    expect(prover.verifyIntervalSum(fullProof)).toBe(true);

    const midProof = prover.proveIntervalSum(2, 6, 'q4-audit');
    expect(midProof.claimedSum).toBe(75n + 420n + 310n + 90n + 640n);
    expect(midProof.coveredSubtrees.length).toBeLessThan(5);
    expect(prover.verifyIntervalSum(midProof)).toBe(true);

    const singleProof = prover.proveIntervalSum(4, 4, 'single-leaf');
    expect(singleProof.claimedSum).toBe(310n);
    expect(prover.verifyIntervalSum(singleProof)).toBe(true);

    const batch = prover.verifyBatchIntervals([fullProof, midProof, singleProof]);
    expect(batch.allValid).toBe(true);
    expect(batch.failedIndices).toEqual([]);

    // Roundtrip serialization
    const deserialized = prover.deserializeProof(prover.serializeProof(midProof));
    expect(prover.verifyIntervalSum(deserialized)).toBe(true);

    // Tampering with claimed sum must fail
    expect(prover.verifyIntervalSum({ ...midProof, claimedSum: midProof.claimedSum + 1n })).toBe(false);
    // Dropping a covered subtree (gap in interval) must fail
    expect(prover.verifyIntervalSum({ ...midProof, coveredSubtrees: midProof.coveredSubtrees.slice(1) })).toBe(false);
    // Wrong domain context must fail
    expect(prover.verifyIntervalSum({ ...midProof, domainContext: 'other' })).toBe(false);
  });
});
