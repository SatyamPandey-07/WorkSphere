import { describe, it, expect } from 'vitest';
import { PedersenVectorCommitmentOpeningProver } from '../../core/zkp/PedersenVectorCommitmentOpeningProver';

describe('PedersenVectorCommitmentOpeningProver', () => {
  const pvc = new PedersenVectorCommitmentOpeningProver();

  it('commits to vectors, supports selective subvector openings, and verifies homomorphic combinations', () => {
    const crs = pvc.setupCRS(6, 'vec-crs-6');
    const v1 = pvc.commitVector(crs, 'v1', [10n, 20n, 30n, 40n, 50n, 60n]);
    const v2 = pvc.commitVector(crs, 'v2', [1n, 2n, 3n, 4n, 5n, 6n]);

    const openProof = pvc.proveSubvectorOpening('open-1', crs, v1, [1, 4]);
    expect(openProof.disclosedEntries).toEqual([
      { index: 1, value: 20n },
      { index: 4, value: 50n },
    ]);
    expect(pvc.verifySubvectorOpening(crs, openProof).valid).toBe(true);

    // Forged disclosed entry must fail
    const forged = {
      ...openProof,
      disclosedEntries: [{ index: 1, value: 21n }, { index: 4, value: 50n }],
    };
    expect(pvc.verifySubvectorOpening(crs, forged).valid).toBe(false);

    // Homomorphic linear combination: 3*v1 + 2*v2
    const combined = pvc.homomorphicLinearCombine(crs, 'v-comb', v1, 3n, v2, 2n);
    expect(combined.values).toEqual([32n, 64n, 96n, 128n, 160n, 192n]);
    const combOpen = pvc.proveSubvectorOpening('open-comb', crs, combined, [0, 5]);
    expect(pvc.verifySubvectorOpening(crs, combOpen).valid).toBe(true);
  });

  it('proves zero-knowledge linear constraints <w, v> == target and round-trips serialization', () => {
    const crs = pvc.setupCRS(4, 'vec-crs-4');
    const v = pvc.commitVector(crs, 'budget-vec', [100n, 250n, 150n, 500n]);
    const weights = [2n, 1n, 3n, 1n]; // 200 + 250 + 450 + 500 = 1400

    const linProof = pvc.proveLinearConstraint('lin-1', crs, v, weights);
    expect(linProof.claimedInnerProduct).toBe(1400n);
    expect(pvc.verifyLinearConstraint(crs, linProof)).toBe(true);
    expect(pvc.verifyLinearConstraint(crs, { ...linProof, claimedInnerProduct: 1401n })).toBe(false);

    const openProof = pvc.proveSubvectorOpening('ser-open', crs, v, [2]);
    const json = pvc.serializeSubvectorProof(openProof);
    const restored = pvc.deserializeSubvectorProof(json);
    expect(restored).toEqual(openProof);
    expect(pvc.verifySubvectorOpening(crs, restored).valid).toBe(true);
  });
});
