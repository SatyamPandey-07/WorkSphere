import {
  SetIntersectionArgument,
  PSIFieldMath,
  PSI_PRIME,
} from '../../core/zkp/SetIntersectionArgument';

describe('SetIntersectionArgument', () => {
  let prover: SetIntersectionArgument;

  beforeEach(() => {
    prover = new SetIntersectionArgument();
  });

  describe('Field Math & Polynomial Root Representation', () => {
    it('performs modular arithmetic mod PSI_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(PSIFieldMath.add(a, b)).toBe((a + b) % PSI_PRIME);
      expect(PSIFieldMath.sub(a, b)).toBe(((a - b) % PSI_PRIME + PSI_PRIME) % PSI_PRIME);
      expect(PSIFieldMath.mul(a, b)).toBe((a * b) % PSI_PRIME);
    });

    it('builds root polynomials and evaluates roots to zero', () => {
      // Roots: 2, 5 -> P(x) = (x - 2)(x - 5) = x^2 - 7x + 10
      const poly = prover.buildRootPoly([2n, 5n]);
      expect(prover.polyEval(poly, 2n)).toBe(0n);
      expect(prover.polyEval(poly, 5n)).toBe(0n);
      expect(prover.polyEval(poly, 3n)).not.toBe(0n);
    });

    it('correctly calculates intersection and disjoint differences', () => {
      const setA = [10n, 20n, 30n, 40n];
      const setB = [30n, 40n, 50n, 60n];

      const res = prover.computeIntersection(setA, setB);
      expect(res.intersection).toEqual([30n, 40n]);
      expect(res.diffA).toEqual([10n, 20n]);
      expect(res.diffB).toEqual([50n, 60n]);
    });
  });

  describe('Zero-Knowledge Private Set Intersection Proving & Verification', () => {
    it('proves and verifies a valid private set intersection', () => {
      const setA = [100n, 200n, 300n];
      const setB = [200n, 300n, 400n];

      const basisA = prover.generateBasis(setA.length, 'BasisA');
      const basisB = prover.generateBasis(setB.length, 'BasisB');
      const basisC = prover.generateBasis(2, 'BasisC'); // intersection size = 2

      const proof = prover.proveIntersection(setA, setB, basisA, basisB, basisC);

      expect(proof.sizeA).toBe(3);
      expect(proof.sizeB).toBe(3);
      expect(proof.sizeC).toBe(2);

      const verification = prover.verifyIntersection(proof);
      expect(verification.valid).toBe(true);
    });

    it('rejects tampered challenge', () => {
      const setA = [1n, 2n];
      const setB = [2n, 3n];

      const basisA = prover.generateBasis(2, 'BasisA');
      const basisB = prover.generateBasis(2, 'BasisB');
      const basisC = prover.generateBasis(1, 'BasisC');

      const proof = prover.proveIntersection(setA, setB, basisA, basisB, basisC);
      const tampered = { ...proof, challenge: proof.challenge + 1n };

      const res = prover.verifyIntersection(tampered);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('challenge mismatch');
    });

    it('rejects falsified intersection divisor evaluation', () => {
      const setA = [1n, 2n];
      const setB = [2n, 3n];

      const basisA = prover.generateBasis(2, 'BasisA');
      const basisB = prover.generateBasis(2, 'BasisB');
      const basisC = prover.generateBasis(1, 'BasisC');

      const proof = prover.proveIntersection(setA, setB, basisA, basisB, basisC);
      const tampered = { ...proof, evalA: proof.evalA + 1n };

      const res = prover.verifyIntersection(tampered);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('divisor homomorphism failed');
    });
  });

  describe('Batch PSI Verification', () => {
    it('verifies a batch of independent set intersection proofs', () => {
      const sA1 = [10n, 20n];
      const sB1 = [20n, 30n];
      const p1 = prover.proveIntersection(
        sA1,
        sB1,
        prover.generateBasis(2, 'A1'),
        prover.generateBasis(2, 'B1'),
        prover.generateBasis(1, 'C1')
      );

      const sA2 = [1n, 2n, 3n, 4n];
      const sB2 = [3n, 4n, 5n];
      const p2 = prover.proveIntersection(
        sA2,
        sB2,
        prover.generateBasis(4, 'A2'),
        prover.generateBasis(3, 'B2'),
        prover.generateBasis(2, 'C2')
      );

      const batch = prover.verifyBatch([p1, p2]);
      expect(batch.valid).toBe(true);
      expect(batch.verifiedCount).toBe(2);
      expect(batch.errors.length).toBe(0);
    });
  });
});
