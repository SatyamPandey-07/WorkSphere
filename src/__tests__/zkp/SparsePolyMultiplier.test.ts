import {
  SparsePolyMultiplier,
  SparseFieldMath,
  SPARSE_PRIME,
  SparsePolynomial,
} from '../../core/zkp/SparsePolyMultiplier';

describe('SparsePolyMultiplier', () => {
  let multiplier: SparsePolyMultiplier;

  beforeEach(() => {
    multiplier = new SparsePolyMultiplier();
  });

  describe('Field Math & Polynomial Evaluation', () => {
    it('performs modular arithmetic mod SPARSE_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(SparseFieldMath.add(a, b)).toBe((a + b) % SPARSE_PRIME);
      expect(SparseFieldMath.sub(a, b)).toBe(((a - b) % SPARSE_PRIME + SPARSE_PRIME) % SPARSE_PRIME);
      expect(SparseFieldMath.mul(a, b)).toBe((a * b) % SPARSE_PRIME);
    });

    it('evaluates sparse polynomials at specific evaluation points', () => {
      // P(x) = 3 + 5x^2 + 2x^4
      const p: SparsePolynomial = [
        { degree: 0, coeff: 3n },
        { degree: 2, coeff: 5n },
        { degree: 4, coeff: 2n },
      ];
      // P(2) = 3 + 5*4 + 2*16 = 3 + 20 + 32 = 55
      expect(multiplier.evaluate(p, 2n)).toBe(55n);
    });
  });

  describe('Sparse Multiplication & Convolution', () => {
    it('computes exact product of two sparse polynomials', () => {
      // A(x) = 1 + 2x
      const a: SparsePolynomial = [
        { degree: 0, coeff: 1n },
        { degree: 1, coeff: 2n },
      ];
      // B(x) = 3 + 4x
      const b: SparsePolynomial = [
        { degree: 0, coeff: 3n },
        { degree: 1, coeff: 4n },
      ];
      // C(x) = (1 + 2x)(3 + 4x) = 3 + 10x + 8x^2
      const c = multiplier.multiply(a, b);
      expect(c).toEqual([
        { degree: 0, coeff: 3n },
        { degree: 1, coeff: 10n },
        { degree: 2, coeff: 8n },
      ]);
    });
  });

  describe('Zero-Knowledge Multiplication Proofs & Verification', () => {
    it('proves and verifies valid polynomial multiplication', () => {
      // A(x) = 2x^2 + 7x^5
      const a: SparsePolynomial = [
        { degree: 2, coeff: 2n },
        { degree: 5, coeff: 7n },
      ];
      // B(x) = 3x + 4x^3
      const b: SparsePolynomial = [
        { degree: 1, coeff: 3n },
        { degree: 3, coeff: 4n },
      ];

      const { proof, c } = multiplier.proveMultiplication(a, b, 11n, 22n);

      expect(c.length).toBeGreaterThan(0);
      expect(proof.zeta > 0n).toBe(true);

      const verification = multiplier.verifyMultiplication(proof);
      expect(verification.valid).toBe(true);
    });

    it('rejects tampered proofs violating Schwartz-Zippel identity', () => {
      const a: SparsePolynomial = [{ degree: 0, coeff: 5n }];
      const b: SparsePolynomial = [{ degree: 0, coeff: 10n }];

      const { proof } = multiplier.proveMultiplication(a, b);

      // Tamper with evaluation
      const tamperedProof = {
        ...proof,
        evalC: proof.evalC + 1n,
      };

      const res = multiplier.verifyMultiplication(tamperedProof);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Schwartz-Zippel');
    });
  });
});
