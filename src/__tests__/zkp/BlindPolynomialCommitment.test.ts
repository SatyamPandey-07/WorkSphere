import { describe, it, expect } from 'vitest';
import {
  BlindPolynomialCommitment,
  BlindPolyFieldMath,
} from '../../core/zkp/BlindPolynomialCommitment';

describe('BlindPolynomialCommitment', () => {
  const bpc = new BlindPolynomialCommitment(32, 99991n);

  it('satisfies perfect hiding: identical polynomials with different blinding produce distinct commitments', () => {
    const poly = [7n, 13n, 19n, 23n];
    const r1 = bpc.sampleBlindingPolynomial(3);
    const r2 = bpc.sampleBlindingPolynomial(3);

    const c1 = bpc.commit(poly, r1);
    const c2 = bpc.commit(poly, r2);

    expect(c1.commitment).not.toBe(c2.commitment);
  });

  it('opens and verifies blinded polynomial evaluations in O(1)', () => {
    const poly = [5n, 11n, 17n, 29n];
    const r = bpc.sampleBlindingPolynomial(3);
    const comm = bpc.commit(poly, r);

    const z = 4n;
    const proof = bpc.openAtPoint(poly, r, z);
    // P(4) = 5 + 44 + 272 + 1856 = 2177
    expect(proof.evaluatedValue).toBe(2177n);

    const res = bpc.verifyOpening(comm, proof);
    expect(res.isValid).toBe(true);
    expect(res.evaluatedValue).toBe(2177n);
  });

  it('supports homomorphic addition of blinded polynomial commitments', () => {
    const p1 = [2n, 3n, 4n];
    const p2 = [5n, 6n, 7n];
    const pSum = [7n, 9n, 11n];

    const r1 = [10n, 20n, 30n];
    const r2 = [40n, 50n, 60n];
    const rSum = [50n, 70n, 90n];

    const c1 = bpc.commit(p1, r1);
    const c2 = bpc.commit(p2, r2);
    const cCombined = bpc.addCommitments(c1, c2);

    const proofSum = bpc.openAtPoint(pSum, rSum, 9n);
    const res = bpc.verifyOpening(cCombined, proofSum);
    expect(res.isValid).toBe(true);
  });

  it('rejects tampered evaluated values or witness proofs', () => {
    const poly = [10n, 20n, 30n];
    const r = bpc.sampleBlindingPolynomial(2);
    const comm = bpc.commit(poly, r);
    const proof = bpc.openAtPoint(poly, r, 5n);

    const tampered = {
      ...proof,
      evaluatedValue: BlindPolyFieldMath.add(proof.evaluatedValue, 1n),
    };

    expect(bpc.verifyOpening(comm, tampered).isValid).toBe(false);
  });
});
