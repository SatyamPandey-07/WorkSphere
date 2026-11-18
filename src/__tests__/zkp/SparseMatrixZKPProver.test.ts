import {
  SparseMatrixZKPProver,
  MatrixFieldMath,
  MATRIX_PRIME,
} from '../../core/zkp/SparseMatrixZKPProver';

describe('SparseMatrixZKPProver', () => {
  let prover: SparseMatrixZKPProver;

  beforeEach(() => {
    prover = new SparseMatrixZKPProver();
  });

  describe('Field Math & CSR Matrix Construction', () => {
    it('performs modular arithmetic mod MATRIX_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(MatrixFieldMath.add(a, b)).toBe((a + b) % MATRIX_PRIME);
      expect(MatrixFieldMath.sub(a, b)).toBe(((a - b) % MATRIX_PRIME + MATRIX_PRIME) % MATRIX_PRIME);
      expect(MatrixFieldMath.mul(a, b)).toBe((a * b) % MATRIX_PRIME);
    });

    it('builds CSR sparse matrix representation', () => {
      const entries = [
        { row: 0, col: 1, val: 5n },
        { row: 1, col: 0, val: 2n },
        { row: 1, col: 2, val: 7n },
      ];
      const csr = prover.createCSRMatrix(2, 3, entries);

      expect(csr.rows).toBe(2);
      expect(csr.cols).toBe(3);
      expect(csr.values).toEqual([5n, 2n, 7n]);
      expect(csr.rowPointers).toEqual([0, 1, 3]);
    });
  });

  describe('Sparse Matrix-Vector Multiplication & Proving', () => {
    it('multiplies sparse matrix and vector correctly', () => {
      // Matrix (2x2):
      // [1, 2]
      // [3, 0]
      const csr = prover.createCSRMatrix(2, 2, [
        { row: 0, col: 0, val: 1n },
        { row: 0, col: 1, val: 2n },
        { row: 1, col: 0, val: 3n },
      ]);
      const x = [4n, 5n];
      // y = [1*4 + 2*5, 3*4 + 0*5] = [14, 12]
      const y = prover.multiply(csr, x);
      expect(y).toEqual([14n, 12n]);
    });

    it('proves and verifies matrix multiplication via Freivalds test', () => {
      const csr = prover.createCSRMatrix(3, 3, [
        { row: 0, col: 0, val: 10n },
        { row: 0, col: 2, val: 3n },
        { row: 1, col: 1, val: 4n },
        { row: 2, col: 0, val: 2n },
        { row: 2, col: 2, val: 8n },
      ]);
      const x = [1n, 2n, 3n];

      const { proof, y } = prover.proveMultiply(csr, x, 11n, 22n);

      expect(y.length).toBe(3);
      expect(proof.evalLHS).toBe(proof.evalRHS);

      const verification = prover.verifyMultiply(proof);
      expect(verification.valid).toBe(true);
    });

    it('rejects tampered proofs with mismatched LHS and RHS', () => {
      const csr = prover.createCSRMatrix(2, 2, [{ row: 0, col: 0, val: 1n }]);
      const x = [5n, 0n];

      const { proof } = prover.proveMultiply(csr, x);

      const tamperedProof = {
        ...proof,
        evalLHS: proof.evalLHS + 1n,
      };

      const res = prover.verifyMultiply(tamperedProof);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Freivalds algebraic identity failed');
    });
  });
});
