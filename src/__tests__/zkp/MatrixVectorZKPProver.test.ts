import { describe, it, expect } from 'vitest';
import {
  MatrixVectorZKPProver,
  MatVecFieldMath,
} from '../../core/zkp/MatrixVectorZKPProver';

describe('MatrixVectorZKPProver', () => {
  const prover = new MatrixVectorZKPProver(32, 32);

  it('proves and verifies rectangular matrix-vector linear layer inference in zero-knowledge', () => {
    // 3x4 linear layer weights matrix
    const matrix: bigint[][] = [
      [1n, 2n, 3n, 4n],
      [5n, 6n, 7n, 8n],
      [9n, 10n, 11n, 12n],
    ];
    const x = [2n, 3n, 5n, 7n];
    // Expected y = [1*2+2*3+3*5+4*7, ...] = [51, 119, 187]

    const { statement, proof, outputY } = prover.proveMatrixVectorProduct(matrix, x);
    expect(outputY).toEqual([51n, 119n, 187n]);

    const res = prover.verifyMatrixVectorProduct(matrix, statement, proof);
    expect(res.isValid).toBe(true);
  });

  it('produces distinct randomized commitments and proofs for identical inputs (zero-knowledge hiding)', () => {
    const matrix: bigint[][] = [
      [3n, 1n],
      [4n, 2n],
    ];
    const x = [10n, 20n];

    const run1 = prover.proveMatrixVectorProduct(matrix, x);
    const run2 = prover.proveMatrixVectorProduct(matrix, x);

    expect(run1.statement.commitmentX).not.toBe(run2.statement.commitmentX);
    expect(run1.statement.commitmentY).not.toBe(run2.statement.commitmentY);
    expect(prover.verifyMatrixVectorProduct(matrix, run1.statement, run1.proof).isValid).toBe(true);
    expect(prover.verifyMatrixVectorProduct(matrix, run2.statement, run2.proof).isValid).toBe(true);
  });

  it('rejects altered matrices or tampered output commitments', () => {
    const matrix: bigint[][] = [
      [2n, 5n, 7n],
      [11n, 13n, 17n],
    ];
    const x = [4n, 6n, 8n];
    const { statement, proof } = prover.proveMatrixVectorProduct(matrix, x);

    // Altered matrix
    const alteredMatrix: bigint[][] = [
      [2n, 5n, 8n], // tampered weight
      [11n, 13n, 17n],
    ];
    expect(prover.verifyMatrixVectorProduct(alteredMatrix, statement, proof).isValid).toBe(false);

    // Tampered output commitment
    const tamperedStmt = {
      ...statement,
      commitmentY: MatVecFieldMath.add(statement.commitmentY, 1n),
    };
    expect(prover.verifyMatrixVectorProduct(matrix, tamperedStmt, proof).isValid).toBe(false);
  });
});
