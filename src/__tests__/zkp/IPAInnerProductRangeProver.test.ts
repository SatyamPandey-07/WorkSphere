import {
  IPAInnerProductRangeProver,
  IPARangeFieldMath,
  IPARANGE_PRIME,
} from '../../core/zkp/IPAInnerProductRangeProver';

describe('IPAInnerProductRangeProver', () => {
  let prover: IPAInnerProductRangeProver;

  beforeEach(() => {
    prover = new IPAInnerProductRangeProver();
  });

  describe('Field Math & Inner Product Basics', () => {
    it('performs field operations modulo IPARANGE_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(IPARangeFieldMath.add(a, b)).toBe((a + b) % IPARANGE_PRIME);
      expect(IPARangeFieldMath.sub(a, b)).toBe(((a - b) % IPARANGE_PRIME + IPARANGE_PRIME) % IPARANGE_PRIME);
      expect(IPARangeFieldMath.mul(a, b)).toBe((a * b) % IPARANGE_PRIME);
    });

    it('computes correct inner product of two vectors', () => {
      const a = [1n, 2n, 3n, 4n];
      const b = [5n, 6n, 7n, 8n];
      // <a, b> = 1*5 + 2*6 + 3*7 + 4*8 = 5 + 12 + 21 + 32 = 70
      expect(prover.innerProduct(a, b)).toBe(70n);
    });

    it('generates power-of-two generator bases and rejects invalid dimensions', () => {
      const basis = prover.generateBasis(4);
      expect(basis.G.length).toBe(4);
      expect(basis.H.length).toBe(4);
      expect(basis.Q > 0n).toBe(true);

      expect(() => prover.generateBasis(3)).toThrow('must be a power of two');
    });
  });

  describe('Recursive IPA Fold Argument', () => {
    it('proves and verifies inner product claim in O(log n) rounds', () => {
      const n = 4;
      const basis = prover.generateBasis(n);
      const a = [3n, 5n, 7n, 11n];
      const b = [2n, 4n, 6n, 8n];

      const { proof, commitment } = prover.prove(a, b, basis);

      expect(proof.dimension).toBe(4);
      expect(proof.rounds).toBe(2); // log2(4) = 2 rounds
      expect(proof.crossCommitments.length).toBe(2);
      expect(proof.challenges.length).toBe(2);

      const verification = prover.verify(commitment, proof, basis);
      expect(verification.valid).toBe(true);
    });

    it('proves and verifies on dimension 8 vectors', () => {
      const n = 8;
      const basis = prover.generateBasis(n);
      const a = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
      const b = [8n, 7n, 6n, 5n, 4n, 3n, 2n, 1n];

      const { proof, commitment } = prover.prove(a, b, basis);

      expect(proof.dimension).toBe(8);
      expect(proof.rounds).toBe(3); // log2(8) = 3 rounds
      const verification = prover.verify(commitment, proof, basis);
      expect(verification.valid).toBe(true);
    });

    it('rejects tampered proofs', () => {
      const n = 4;
      const basis = prover.generateBasis(n);
      const a = [1n, 2n, 3n, 4n];
      const b = [1n, 1n, 1n, 1n];

      const { proof, commitment } = prover.prove(a, b, basis);

      // Tamper with challenge
      const forged = { ...proof, challenges: [proof.challenges[0] + 1n, proof.challenges[1]] };
      const res = prover.verify(commitment, forged, basis);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Fiat-Shamir challenge mismatch');
    });
  });
});
