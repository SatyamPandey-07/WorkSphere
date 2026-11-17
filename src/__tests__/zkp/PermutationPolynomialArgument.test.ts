import {
  PermutationPolynomialArgument,
  PermutationFieldMath,
  PERM_PRIME,
} from '../../core/zkp/PermutationPolynomialArgument';

describe('PermutationPolynomialArgument', () => {
  let prover: PermutationPolynomialArgument;

  beforeEach(() => {
    prover = new PermutationPolynomialArgument();
  });

  describe('Field Math & Grand Product Accumulator', () => {
    it('performs modular arithmetic mod PERM_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(PermutationFieldMath.add(a, b)).toBe((a + b) % PERM_PRIME);
      expect(PermutationFieldMath.sub(a, b)).toBe(((a - b) % PERM_PRIME + PERM_PRIME) % PERM_PRIME);
      expect(PermutationFieldMath.mul(a, b)).toBe((a * b) % PERM_PRIME);
    });

    it('computes grand product terminating at 1 for genuine permutation', () => {
      const x = [10n, 20n, 30n, 40n];
      const sigma = [2, 0, 3, 1]; // y[0]=x[2]=30, y[1]=x[0]=10, y[2]=x[3]=40, y[3]=x[1]=20
      const y = [30n, 10n, 40n, 20n];

      const beta = 5n;
      const gamma = 7n;
      const Z = prover.computeGrandProduct(x, y, sigma, beta, gamma);

      expect(Z.length).toBe(5);
      expect(Z[0]).toBe(1n);
      expect(Z[4]).toBe(1n);
    });

    it('does not terminate at 1 for invalid non-permutation vector', () => {
      const x = [10n, 20n, 30n, 40n];
      const sigma = [2, 0, 3, 1];
      const y = [30n, 10n, 40n, 999n]; // 999 instead of 20

      const beta = 5n;
      const gamma = 7n;
      const Z = prover.computeGrandProduct(x, y, sigma, beta, gamma);

      expect(Z[4]).not.toBe(1n);
    });
  });

  describe('Zero-Knowledge Permutation Proof Generation & Verification', () => {
    it('proves and verifies a valid vector permutation', () => {
      const n = 4;
      const basis = prover.generateBasis(n);
      const x = [11n, 22n, 33n, 44n];
      const sigma = [3, 2, 1, 0];
      const y = [44n, 33n, 22n, 11n];

      const proof = prover.provePermutation(x, y, sigma, basis);

      expect(proof.dimension).toBe(n);
      expect(proof.finalAccumulator).toBe(1n);

      const verification = prover.verifyPermutation(proof, sigma);
      expect(verification.valid).toBe(true);
    });

    it('rejects an invalid challenge', () => {
      const n = 3;
      const basis = prover.generateBasis(n);
      const x = [1n, 2n, 3n];
      const sigma = [1, 2, 0];
      const y = [2n, 3n, 1n];

      const proof = prover.provePermutation(x, y, sigma, basis);
      const tampered = { ...proof, challenge: proof.challenge + 1n };

      const res = prover.verifyPermutation(tampered, sigma);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('challenge mismatch');
    });

    it('rejects if grand product does not equal 1', () => {
      const n = 3;
      const basis = prover.generateBasis(n);
      const x = [1n, 2n, 3n];
      const sigma = [1, 2, 0];
      const y = [2n, 3n, 1n];

      const proof = prover.provePermutation(x, y, sigma, basis);
      const tampered = { ...proof, finalAccumulator: 2n };

      const res = prover.verifyPermutation(tampered, sigma);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('does not terminate at 1');
    });
  });

  describe('Batch Permutation Verification', () => {
    it('verifies a batch of independent permutation arguments', () => {
      const b2 = prover.generateBasis(2);
      const b3 = prover.generateBasis(3);

      const s2 = [1, 0];
      const p1 = prover.provePermutation([100n, 200n], [200n, 100n], s2, b2);

      const s3 = [2, 0, 1];
      const p2 = prover.provePermutation([5n, 10n, 15n], [15n, 5n, 10n], s3, b3);

      const batchRes = prover.verifyBatch([p1, p2], [s2, s3]);
      expect(batchRes.valid).toBe(true);
      expect(batchRes.verifiedCount).toBe(2);
      expect(batchRes.errors.length).toBe(0);
    });
  });
});
