import { describe, it, expect } from 'vitest';
import {
  generateIPABasis,
  IPATranscript,
  IPAPolynomialCommitment,
  IPA_PRIME,
  type IPABatchEvaluationClaim,
} from '../../core/zkp/IPAPolynomialCommitment';

describe('IPAPolynomialCommitment Scheme', () => {
  describe('Generator Basis & Transcript', () => {
    it('generates transparent NUMS basis of power of 2 length', () => {
      const basis = generateIPABasis(8);
      expect(basis.n).toBe(8);
      expect(basis.gBasis.length).toBe(8);
      expect(basis.hBasis.length).toBe(8);
      expect(basis.qGen > 0n).toBe(true);
      expect(basis.qGen < IPA_PRIME).toBe(true);
    });

    it('rejects non-power-of-2 basis sizes', () => {
      expect(() => generateIPABasis(7)).toThrow('must be a positive power of 2');
      expect(() => generateIPABasis(0)).toThrow('must be a positive power of 2');
    });

    it('derives deterministic non-zero Fiat-Shamir challenges', () => {
      const t1 = new IPATranscript('test_label');
      t1.absorbScalar(12345n);
      const c1 = t1.squeezeChallenge();

      const t2 = new IPATranscript('test_label');
      t2.absorbScalar(12345n);
      const c2 = t2.squeezeChallenge();

      expect(c1).toBe(c2);
      expect(c1 > 0n).toBe(true);
      expect(c1 < IPA_PRIME).toBe(true);
    });
  });

  describe('Polynomial Commitment & Inner Product Argument', () => {
    const ipa = new IPAPolynomialCommitment(8);

    it('computes correct polynomial evaluation', () => {
      // p(X) = 3 + 2X + 5X^2
      // p(4) = 3 + 8 + 80 = 91
      const coeffs = [3n, 2n, 5n];
      const val = ipa.evaluatePolynomial(coeffs, 4n);
      expect(val).toBe(91n);
    });

    it('commits, opens, and verifies evaluation proof with O(log n) rounds', () => {
      const coeffs = [5n, 12n, 3n, 7n];
      const z = 3n;
      const expectedValue = ipa.evaluatePolynomial(coeffs, z);
      const commitment = ipa.commit(coeffs);

      const proof = ipa.open(coeffs, z);
      expect(proof.lVec.length).toBe(Math.log2(8));
      expect(proof.rVec.length).toBe(Math.log2(8));

      const isValid = ipa.verify(commitment, z, expectedValue, proof);
      expect(isValid).toBe(true);
    });

    it('rejects fraudulent evaluation claims', () => {
      const coeffs = [10n, 20n, 30n, 40n];
      const z = 2n;
      const correctValue = ipa.evaluatePolynomial(coeffs, z);
      const commitment = ipa.commit(coeffs);
      const proof = ipa.open(coeffs, z);

      // Fraudulent value
      const fakeValue = correctValue + 1n;
      const checkWrongValue = ipa.verify(commitment, z, fakeValue, proof);
      expect(checkWrongValue).toBe(false);

      // Fraudulent evaluation point
      const checkWrongPoint = ipa.verify(commitment, z + 1n, correctValue, proof);
      expect(checkWrongPoint).toBe(false);

      // Tampered proof
      const tamperedProof = {
        ...proof,
        finalA: proof.finalA + 1n,
      };
      const checkTamperedProof = ipa.verify(commitment, z, correctValue, tamperedProof);
      expect(checkTamperedProof).toBe(false);
    });

    it('batch verifies multiple polynomial evaluation claims', () => {
      const poly1 = [1n, 2n, 3n, 4n];
      const z1 = 5n;
      const v1 = ipa.evaluatePolynomial(poly1, z1);
      const c1 = ipa.commit(poly1);
      const p1 = ipa.open(poly1, z1);

      const poly2 = [10n, 15n, 20n];
      const z2 = 7n;
      const v2 = ipa.evaluatePolynomial(poly2, z2);
      const c2 = ipa.commit(poly2);
      const p2 = ipa.open(poly2, z2);

      const claims: IPABatchEvaluationClaim[] = [
        { commitment: c1, point: z1, value: v1, proof: p1 },
        { commitment: c2, point: z2, value: v2, proof: p2 },
      ];

      const batchResult = ipa.batchVerify(claims);
      expect(batchResult).toBe(true);

      // If one claim is invalid, batch verification fails
      const corruptClaims: IPABatchEvaluationClaim[] = [
        { commitment: c1, point: z1, value: v1 + 1n, proof: p1 },
        { commitment: c2, point: z2, value: v2, proof: p2 },
      ];
      expect(ipa.batchVerify(corruptClaims)).toBe(false);
    });
  });
});
