import {
  PolyEvalArgument,
  PolyFieldMath,
  POLYEVAL_PRIME,
} from '../../core/zkp/PolyEvalArgument';

describe('PolyEvalArgument', () => {
  let prover: PolyEvalArgument;

  beforeEach(() => {
    prover = new PolyEvalArgument();
  });

  describe('Field Math & Polynomial Evaluation', () => {
    it('performs modular arithmetic mod POLYEVAL_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(PolyFieldMath.add(a, b)).toBe((a + b) % POLYEVAL_PRIME);
      expect(PolyFieldMath.sub(a, b)).toBe(((a - b) % POLYEVAL_PRIME + POLYEVAL_PRIME) % POLYEVAL_PRIME);
      expect(PolyFieldMath.mul(a, b)).toBe((a * b) % POLYEVAL_PRIME);
    });

    it('computes modular exponentiation and inversion', () => {
      const val = 123456789n;
      const inv = PolyFieldMath.inv(val);
      expect(PolyFieldMath.mul(val, inv)).toBe(1n);
      expect(() => PolyFieldMath.inv(0n)).toThrow('Cannot invert zero');
    });

    it('evaluates polynomials accurately using Horner scheme', () => {
      // P(x) = 5 + 3x + 2x^2
      const poly = [5n, 3n, 2n];
      // P(2) = 5 + 6 + 8 = 19
      expect(prover.evaluate(poly, 2n)).toBe(19n);
      // P(0) = 5
      expect(prover.evaluate(poly, 0n)).toBe(5n);
    });
  });

  describe('Quotient Polynomial Decomposition', () => {
    it('computes exact quotient polynomial Q(x) = (P(x) - v) / (x - z)', () => {
      // P(x) = x^2 - 1 = -1 + 0*x + 1*x^2
      // P(3) = 8
      // (P(x) - 8) / (x - 3) = (x^2 - 9) / (x - 3) = x + 3 = 3 + 1*x
      const poly = [-1n, 0n, 1n];
      const z = 3n;
      const v = prover.evaluate(poly, z); // 8n
      const quotient = prover.computeQuotient(poly, z, v);

      expect(quotient).toEqual([3n, 1n]);
    });

    it('throws when evaluation claim does not match polynomial value', () => {
      const poly = [1n, 2n, 3n];
      expect(() => prover.computeQuotient(poly, 2n, 9999n)).toThrow('Invalid evaluation claim');
    });
  });

  describe('Succinct Evaluation Proof Generation & Verification', () => {
    it('proves and verifies a correct polynomial evaluation claim', () => {
      // P(x) = 4 + 7x + 3x^2 + 5x^3
      const poly = [4n, 7n, 3n, 5n];
      const z = 10n;
      const blinding = 42n;

      const { proof, commitment } = prover.proveEvaluation(poly, z, blinding);

      expect(proof.point).toBe(z);
      expect(proof.claimedValue).toBe(prover.evaluate(poly, z));
      expect(proof.degree).toBe(3);

      const verification = prover.verifyEvaluation(commitment, proof);
      expect(verification.valid).toBe(true);
    });

    it('rejects tampered proofs with mismatched challenges', () => {
      const poly = [1n, 2n, 3n];
      const { proof, commitment } = prover.proveEvaluation(poly, 5n);

      const tamperedProof = {
        ...proof,
        challenge: proof.challenge + 1n,
      };

      const res = prover.verifyEvaluation(commitment, tamperedProof);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('challenge mismatch');
    });
  });

  describe('Batch Multi-Point Evaluation', () => {
    it('proves and verifies multi-point batch evaluations', () => {
      const poly = [2n, 4n, 6n, 8n];
      const points = [1n, 2n, 3n];

      const { commitment } = prover.proveEvaluation(poly, points[0]);
      const batchProof = prover.proveBatch(poly, points);

      expect(batchProof.points).toEqual(points);
      expect(batchProof.claimedValues.length).toBe(3);

      const verifyRes = prover.verifyBatch(commitment, batchProof);
      expect(verifyRes.valid).toBe(true);
    });
  });
});
