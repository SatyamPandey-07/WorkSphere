import { describe, it, expect } from 'vitest';
import { VerifiablePolynomialRootProofProver } from '../../core/zkp/VerifiablePolynomialRootProofProver';

describe('VerifiablePolynomialRootProofProver', () => {
  const prover = new VerifiablePolynomialRootProofProver();

  it('proves a hidden committed polynomial vanishes on a target root set without revealing P or Q', () => {
    const roots = [3n, 7n, 11n];
    const vanish = prover.buildVanishingPoly(roots);
    const secretFactor = [5n, 2n, 9n]; // 5 + 2x + 9x^2
    const polyP = prover.multiplyPolys(vanish, secretFactor);

    for (const r of roots) {
      expect(prover.evaluatePoly(polyP, r)).toBe(0n);
    }

    const commP = prover.commitPoly('poly-vanish-1', polyP);
    const proof = prover.proveVanishingRoots('vp-1', commP, roots, 3);
    expect(prover.verifyVanishingRoots(proof).valid).toBe(true);

    // Tampering with roots or responseDeltaR must fail verification
    expect(prover.verifyVanishingRoots({ ...proof, roots: [3n, 7n, 12n] }).valid).toBe(false);
    expect(
      prover.verifyVanishingRoots({
        ...proof,
        rounds: [
          { ...proof.rounds[0], responseDeltaR: proof.rounds[0].responseDeltaR + 1n },
          ...proof.rounds.slice(1),
        ],
      }).valid
    ).toBe(false);
  });

  it('rejects polynomials that do not vanish on all roots and round-trips serialization', () => {
    const nonVanish = prover.commitPoly('bad-p', [1n, 2n, 3n, 4n]);
    expect(() => prover.proveVanishingRoots('fail', nonVanish, [5n, 6n])).toThrow();

    const vanish = prover.buildVanishingPoly([2n, 4n]);
    const polyP = prover.multiplyPolys(vanish, [7n, 1n]);
    const commP = prover.commitPoly('good-p', polyP);
    const proof = prover.proveVanishingRoots('vp-ser', commP, [2n, 4n], 2);

    const json = prover.serializeProof(proof);
    const restored = prover.deserializeProof(json);
    expect(restored).toEqual(proof);
    expect(prover.verifyVanishingRoots(restored).valid).toBe(true);
  });
});
