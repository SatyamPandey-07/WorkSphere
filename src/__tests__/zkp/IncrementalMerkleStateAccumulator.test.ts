import { describe, it, expect } from 'vitest';
import { IncrementalMerkleStateAccumulator } from '../../core/zkp/IncrementalMerkleStateAccumulator';

describe('IncrementalMerkleStateAccumulator', () => {
  it('maintains an O(log N) frontier whose root matches exact RFC-6962 subtree hashing for all sizes', () => {
    const log = new IncrementalMerkleStateAccumulator();
    for (let i = 0; i < 19; i++) {
      const cp = log.append(`audit-event-${i}`);
      const exactRoot = log.computeSubtreeHash(0, i + 1);
      expect(cp.treeSize).toBe(i + 1);
      expect(cp.rootHash).toBe(exactRoot);
    }
  });

  it('generates and verifies inclusion proofs for every historical leaf and rejects tampered payloads', () => {
    const log = new IncrementalMerkleStateAccumulator();
    const events = Array.from({ length: 13 }, (_, i) => `workspace-state-transition:${i}`);
    const cp = log.appendBatch(events);

    const allProofs = events.map((_, idx) => log.generateInclusionProof(idx));
    const batch = log.batchVerifyInclusions(allProofs, cp.rootHash);
    expect(batch.allValid).toBe(true);
    expect(batch.validCount).toBe(13);

    const forged = { ...allProofs[5], leafPayload: 'workspace-state-transition:forged' };
    expect(log.verifyInclusionProof(forged, cp.rootHash).valid).toBe(false);
    expect(log.verifyInclusionProof(allProofs[0], '0'.repeat(64)).valid).toBe(false);
  });

  it('generates and verifies RFC-6962 append-only consistency proofs across arbitrary checkpoints', () => {
    const log = new IncrementalMerkleStateAccumulator();
    for (let i = 0; i < 17; i++) {
      log.append(`tx-${i}`);
    }

    // Test every combination of power-of-two and non-power-of-two sizes
    const pairs: Array<[number, number]> = [
      [1, 1],
      [1, 2],
      [2, 5],
      [3, 7],
      [4, 8],
      [4, 13],
      [7, 16],
      [8, 17],
      [11, 17],
    ];

    for (const [m, n] of pairs) {
      const proof = log.generateConsistencyProof(m, n);
      expect(log.verifyConsistencyProof(proof).valid).toBe(true);
    }

    // Tampered historical root must fail consistency check
    const cProof = log.generateConsistencyProof(5, 13);
    expect(log.verifyConsistencyProof({ ...cProof, firstRoot: 'f'.repeat(64) }).valid).toBe(false);
    expect(log.verifyConsistencyProof({ ...cProof, secondRoot: 'e'.repeat(64) }).valid).toBe(false);

    const json = log.serializeConsistencyProof(cProof);
    const restored = log.deserializeConsistencyProof(json);
    expect(restored).toEqual(cProof);
    expect(log.verifyConsistencyProof(restored).valid).toBe(true);
  });
});
