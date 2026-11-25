import { describe, it, expect } from 'vitest';
import { BulletproofInnerProductVerifier } from '../../core/zkp/BulletproofInnerProductVerifier';

describe('BulletproofInnerProductVerifier', () => {
  const ipa = new BulletproofInnerProductVerifier();

  it('proves and verifies logarithmic O(log n) inner-product folding arguments for dimension 8', () => {
    const crs = ipa.setupCRS(8, 'ws-ipa-dim8');
    const vecA = [3n, 7n, 2n, 9n, 5n, 1n, 8n, 4n];
    const vecB = [6n, 2n, 5n, 3n, 8n, 4n, 1n, 7n];

    const proof = ipa.prove('ipa-proof-1', crs, vecA, vecB);
    expect(proof.rounds).toHaveLength(3); // log2(8) = 3
    expect(proof.claimedInnerProduct).toBe(ipa.innerProduct(vecA, vecB));
    expect(ipa.verify(crs, proof).valid).toBe(true);

    // Tampering with finalA, finalB, or any L/R cross-term must fail verification
    expect(ipa.verify(crs, { ...proof, finalA: proof.finalA + 1n }).valid).toBe(false);
    expect(ipa.verify(crs, { ...proof, finalB: proof.finalB + 1n }).valid).toBe(false);
    expect(
      ipa.verify(crs, {
        ...proof,
        rounds: [
          { ...proof.rounds[0], leftCommitL: proof.rounds[0].leftCommitL + 1n },
          ...proof.rounds.slice(1),
        ],
      }).valid
    ).toBe(false);
  });

  it('rejects non-power-of-two dimensions and batch-verifies multiple IPA proofs', () => {
    expect(() => ipa.setupCRS(6, 'bad')).toThrow();

    const crs = ipa.setupCRS(4, 'ws-ipa-dim4');
    const p1 = ipa.prove('p1', crs, [1n, 2n, 3n, 4n], [4n, 3n, 2n, 1n]);
    const p2 = ipa.prove('p2', crs, [10n, 20n, 30n, 40n], [2n, 1n, 5n, 3n]);

    const ok = ipa.batchVerify(crs, [p1, p2]);
    expect(ok.allValid).toBe(true);
    expect(ok.validCount).toBe(2);
    expect(ok.failedProofIds).toEqual([]);

    const bad = ipa.batchVerify(crs, [p1, { ...p2, commitmentP: p2.commitmentP + 1n }]);
    expect(bad.allValid).toBe(false);
    expect(bad.failedProofIds).toEqual(['p2']);
  });

  it('round-trips JSON serialization for Bulletproofs IPA proofs', () => {
    const crs = ipa.setupCRS(4, 'ws-ipa-ser');
    const proof = ipa.prove('ipa-ser', crs, [5n, 8n, 13n, 21n], [2n, 3n, 5n, 7n]);

    const json = ipa.serializeProof(proof);
    const restored = ipa.deserializeProof(json);
    expect(restored).toEqual(proof);
    expect(ipa.verify(crs, restored).valid).toBe(true);
  });
});
