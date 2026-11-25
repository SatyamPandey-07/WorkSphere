import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleMountainRangeProver } from '../../core/zkp/ZeroKnowledgeMerkleMountainRangeProver';

describe('ZeroKnowledgeMerkleMountainRangeProver', () => {
  it('appends leaves in O(log N) merges and verifies inclusion proofs across arbitrary MMR sizes', () => {
    const mmr = new ZeroKnowledgeMerkleMountainRangeProver();
    const events = Array.from({ length: 11 }, (_, i) => `mmr-event-${i}`);
    const snap = mmr.appendBatch(events);

    expect(snap.leafCount).toBe(11);
    expect(snap.peaks.length).toBe(3); // 11 = 8 + 2 + 1 -> 3 mountain peaks!

    const proofs = events.map((_, idx) => mmr.generateInclusionProof(idx));
    const batch = mmr.batchVerifyProofs(proofs, snap.baggedRootHash);
    expect(batch.allValid).toBe(true);
    expect(batch.validCount).toBe(11);

    // Tampered leaf payload or wrong root must fail
    expect(mmr.verifyInclusionProof({ ...proofs[4], leafPayload: 'forged' }, snap.baggedRootHash).valid).toBe(false);
    expect(mmr.verifyInclusionProof(proofs[0], '0'.repeat(64)).valid).toBe(false);
  });

  it('verifies historical proofs against earlier MMR snapshots and round-trips serialization', () => {
    const mmr = new ZeroKnowledgeMerkleMountainRangeProver();
    let snapAt5!: ReturnType<typeof mmr.getSnapshot>;
    for (let i = 0; i < 9; i++) {
      const s = mmr.append(`block-${i}`);
      if (i === 4) snapAt5 = s;
    }

    const histProof = mmr.generateInclusionProof(2, snapAt5.nodeCount);
    expect(mmr.verifyInclusionProof(histProof, snapAt5.baggedRootHash).valid).toBe(true);

    const json = mmr.serializeProof(histProof);
    const restored = mmr.deserializeProof(json);
    expect(restored).toEqual(histProof);
    expect(mmr.verifyInclusionProof(restored, snapAt5.baggedRootHash).valid).toBe(true);
  });
});
