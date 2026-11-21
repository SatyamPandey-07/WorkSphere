import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeCommitmentMatrixProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeCommitmentMatrixProver';

describe('ZeroKnowledgeCommitmentMatrixProver', () => {
  const prover = new ZeroKnowledgeCommitmentMatrixProver();

  it('proves committed matrix-vector products via O(m+n) Freivalds folding and rejects tampered matrices or outputs', () => {
    const matrix = [
      [2n, 0n, 3n, 1n],
      [4n, 5n, 1n, 2n],
      [1n, 3n, 2n, 6n],
    ];
    const xVec = [7n, 11n, 5n, 9n];
    const yVec = prover.multiplyMatrixVector(matrix, xVec);
    expect(yVec).toEqual([38n, 106n, 104n]);

    const xComm = prover.commitVector(xVec);
    const yComm = prover.commitVector(yVec);

    const proof = prover.proveMatrixVectorProduct(matrix, xComm, yComm, 'ml-linear-layer-1');
    expect(prover.verifyMatrixVectorProduct(proof)).toBe(true);

    const badOutput = [...proof.outputCommitments];
    badOutput[1] = (badOutput[1] * 4n) % SAFE_PRIME_P;
    expect(prover.verifyMatrixVectorProduct({ ...proof, outputCommitments: badOutput })).toBe(false);

    const badMatrix = matrix.map((r) => [...r]);
    badMatrix[0][2] = 4n;
    expect(prover.verifyMatrixVectorProduct({ ...proof, matrix: badMatrix })).toBe(false);

    const json = JSON.parse(prover.serializeProof(proof)) as { rows: number; cols: number };
    expect(json.rows).toBe(3);
    expect(json.cols).toBe(4);
  });

  it('handles identity matrices, zero vectors, rectangular tall/wide layers, and modular negative weights', () => {
    // 1x1 trivial case
    const m1 = [[9n]];
    const x1 = prover.commitVector([12n]);
    const y1 = prover.commitVector([108n]);
    expect(prover.verifyMatrixVectorProduct(prover.proveMatrixVectorProduct(m1, x1, y1, '1x1'))).toBe(true);

    // Tall 5x2 matrix with negative modular coefficients (e.g., -3n)
    const tall = [
      [1n, -2n],
      [-3n, 4n],
      [0n, 0n],
      [7n, 8n],
      [-1n, -1n],
    ];
    const xTall = [10n, 3n];
    const yTall = prover.multiplyMatrixVector(tall, xTall);
    const pTall = prover.proveMatrixVectorProduct(tall, prover.commitVector(xTall), prover.commitVector(yTall), 'tall-layer');
    expect(prover.verifyMatrixVectorProduct(pTall)).toBe(true);

    // Wide 2x5 matrix with zero witness vector
    const wide = [
      [5n, 6n, 7n, 8n, 9n],
      [1n, 2n, 3n, 4n, 5n],
    ];
    const xZero = [0n, 0n, 0n, 0n, 0n];
    const yZero = prover.multiplyMatrixVector(wide, xZero);
    expect(yZero).toEqual([0n, 0n]);
    const pZero = prover.proveMatrixVectorProduct(wide, prover.commitVector(xZero), prover.commitVector(yZero), 'zero-vec');
    expect(prover.verifyMatrixVectorProduct(pZero)).toBe(true);
  });

  it('chains multi-layer neural linear inference proofs reusing hidden layer commitments', () => {
    const W1 = [
      [3n, 1n, 2n],
      [1n, 4n, 1n],
    ];
    const W2 = [
      [2n, 5n],
      [6n, 1n],
      [1n, 1n],
    ];
    const x = [4n, 2n, 5n];
    const h = prover.multiplyMatrixVector(W1, x);
    const out = prover.multiplyMatrixVector(W2, h);

    const cX = prover.commitVector(x);
    const cH = prover.commitVector(h);
    const cOut = prover.commitVector(out);

    const proofL1 = prover.proveMatrixVectorProduct(W1, cX, cH, 'layer-1');
    const proofL2 = prover.proveMatrixVectorProduct(W2, cH, cOut, 'layer-2');

    expect(prover.verifyMatrixVectorProduct(proofL1)).toBe(true);
    expect(prover.verifyMatrixVectorProduct(proofL2)).toBe(true);
    // Hidden commitment links both proofs seamlessly
    expect(proofL1.outputCommitments).toEqual(proofL2.inputCommitments);
  });

  it('rejects dimension mismatches, jagged matrices, and tampered proof fields', () => {
    expect(() => prover.commitVector([])).toThrow();
    expect(() => prover.multiplyMatrixVector([], [1n])).toThrow();
    expect(() => prover.multiplyMatrixVector([[1n, 2n], [3n]], [1n, 2n])).toThrow();

    const M = [[2n, 3n], [4n, 5n]];
    const cX = prover.commitVector([1n, 2n]);
    const wrongY = prover.commitVector([99n, 14n]);
    expect(() => prover.proveMatrixVectorProduct(M, cX, wrongY)).toThrow();
    expect(() => prover.proveMatrixVectorProduct(M, cX, prover.commitVector([8n]))).toThrow();

    const validY = prover.commitVector(prover.multiplyMatrixVector(M, [1n, 2n]));
    const proof = prover.proveMatrixVectorProduct(M, cX, validY, 'tamper-suite');
    expect(prover.verifyMatrixVectorProduct(proof)).toBe(true);

    expect(prover.verifyMatrixVectorProduct({ ...proof, rows: 0 })).toBe(false);
    expect(prover.verifyMatrixVectorProduct({ ...proof, cols: 3 })).toBe(false);
    expect(prover.verifyMatrixVectorProduct({ ...proof, freivaldsAlpha: (proof.freivaldsAlpha + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyMatrixVectorProduct({ ...proof, challenge: (proof.challenge + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyMatrixVectorProduct({ ...proof, responseBlinding: (proof.responseBlinding + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyMatrixVectorProduct({ ...proof, announcementR: (proof.announcementR * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(prover.verifyMatrixVectorProduct({ ...proof, context: 'other-ctx' })).toBe(false);
    const badIn = [...proof.inputCommitments];
    badIn[0] = (badIn[0] * 4n) % SAFE_PRIME_P;
    expect(prover.verifyMatrixVectorProduct({ ...proof, inputCommitments: badIn })).toBe(false);
  });
});
