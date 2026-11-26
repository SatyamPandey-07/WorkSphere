import {
  FoldingAccumulatorProver,
  FoldingFieldMath,
  FOLD_PRIME,
  R1CSMatrices,
  RelaxedR1CSInstance,
} from '../../core/zkp/FoldingAccumulatorProver';

describe('FoldingAccumulatorProver', () => {
  let prover: FoldingAccumulatorProver;

  beforeEach(() => {
    prover = new FoldingAccumulatorProver();
  });

  describe('Field Math & Relaxed R1CS Satisfaction', () => {
    it('performs modular arithmetic mod FOLD_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(FoldingFieldMath.add(a, b)).toBe((a + b) % FOLD_PRIME);
      expect(FoldingFieldMath.sub(a, b)).toBe(((a - b) % FOLD_PRIME + FOLD_PRIME) % FOLD_PRIME);
      expect(FoldingFieldMath.mul(a, b)).toBe((a * b) % FOLD_PRIME);
    });

    it('verifies honest relaxed R1CS relation Az o Bz == u * Cz + E', () => {
      // 1 constraint: w * w == x
      // z = [w, x, u]
      // A = [1, 0, 0], B = [1, 0, 0], C = [0, 1, 0]
      const matrices: R1CSMatrices = {
        numRows: 1,
        numCols: 3,
        A: [[1n, 0n, 0n]],
        B: [[1n, 0n, 0n]],
        C: [[0n, 1n, 0n]],
      };

      const w = [3n]; // 3 * 3 = 9
      const instance: RelaxedR1CSInstance = {
        commitmentW: 0n,
        commitmentE: 0n,
        publicInputs: [9n],
        u: 1n,
      };
      const E = [0n];

      expect(prover.checkRelaxedR1CS(matrices, instance, w, E)).toBe(true);
    });
  });

  describe('Recursive Accumulator Folding', () => {
    it('folds two satisfied instances into an accumulated instance satisfying R1CS', () => {
      // Constraint: w * w == x
      const matrices: R1CSMatrices = {
        numRows: 1,
        numCols: 3,
        A: [[1n, 0n, 0n]],
        B: [[1n, 0n, 0n]],
        C: [[0n, 1n, 0n]],
      };

      const basisW = prover.generateBasis(1, 'BasisW');
      const basisE = prover.generateBasis(1, 'BasisE');

      // Instance 1: w1 = 3, x1 = 9
      const w1 = [3n];
      const inst1: RelaxedR1CSInstance = {
        commitmentW: prover.commitVector(w1, basisW),
        commitmentE: 0n,
        publicInputs: [9n],
        u: 1n,
      };
      const E1 = [0n];

      // Instance 2: w2 = 4, x2 = 16
      const w2 = [4n];
      const inst2: RelaxedR1CSInstance = {
        commitmentW: prover.commitVector(w2, basisW),
        commitmentE: 0n,
        publicInputs: [16n],
        u: 1n,
      };
      const E2 = [0n];

      // Verify both individually
      expect(prover.checkRelaxedR1CS(matrices, inst1, w1, E1)).toBe(true);
      expect(prover.checkRelaxedR1CS(matrices, inst2, w2, E2)).toBe(true);

      // Fold them
      const foldRes = prover.fold(matrices, inst1, w1, E1, inst2, w2, E2, basisW, basisE);

      // Verify the folded instance satisfies the relaxed R1CS relation!
      const isFoldSatisfied = prover.checkRelaxedR1CS(
        matrices,
        foldRes.foldedInstance,
        foldRes.foldedWitness,
        foldRes.foldedE
      );
      expect(isFoldSatisfied).toBe(true);

      // Verifier check without witnesses
      const verifyRes = prover.verifyFold(inst1, inst2, foldRes.commitmentT, foldRes.foldedInstance);
      expect(verifyRes.valid).toBe(true);
    });
  });
});
