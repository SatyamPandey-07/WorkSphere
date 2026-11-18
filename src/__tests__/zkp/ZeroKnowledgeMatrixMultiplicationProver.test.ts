import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMatrixMultiplicationProver } from '../../core/zkp/ZeroKnowledgeMatrixMultiplicationProver';

describe('ZeroKnowledgeMatrixMultiplicationProver', () => {
  const prover = new ZeroKnowledgeMatrixMultiplicationProver();

  it('proves and verifies committed matrix multiplication C = A * B without disclosing B or C', () => {
    const A = [
      [2n, 5n, 1n],
      [3n, 0n, 4n],
    ];
    const B = [
      [7n, 1n],
      [2n, 6n],
      [4n, 3n],
    ];
    const C = prover.multiplyMatrices(A, B);
    expect(C).toEqual([
      [28n, 35n],
      [37n, 15n],
    ]);

    const commB = prover.commitMatrix('B-weights', B);
    const commC = prover.commitMatrix('C-output', C);

    const proof = prover.proveMatrixProduct('matmul-layer-1', A, commB, commC, 3);
    expect(proof.rounds).toHaveLength(3);
    expect(prover.verifyMatrixProduct(proof).valid).toBe(true);
  });

  it('rejects incorrect claimed matrix products and tampered projection rounds', () => {
    const A = [
      [1n, 2n],
      [3n, 4n],
    ];
    const B = [
      [5n, 6n],
      [7n, 8n],
    ];
    const wrongC = [
      [19n, 22n],
      [43n, 51n], // should be 50n
    ];

    const commB = prover.commitMatrix('B-2', B);
    const commWrongC = prover.commitMatrix('C-wrong', wrongC);
    const forgedProof = prover.proveMatrixProduct('matmul-wrong', A, commB, commWrongC, 2);

    expect(prover.verifyMatrixProduct(forgedProof).valid).toBe(false);

    const trueC = prover.multiplyMatrices(A, B);
    const commTrueC = prover.commitMatrix('C-true', trueC);
    const validProof = prover.proveMatrixProduct('matmul-good', A, commB, commTrueC, 2);

    const tampered = {
      ...validProof,
      rounds: [
        { ...validProof.rounds[0], responseDeltaR: validProof.rounds[0].responseDeltaR + 1n },
        validProof.rounds[1],
      ],
    };
    expect(prover.verifyMatrixProduct(tampered).valid).toBe(false);
  });

  it('rejects incompatible dimensions and round-trips JSON serialization', () => {
    const A = [[1n, 2n]];
    const B = [[3n], [4n]];
    const C = prover.multiplyMatrices(A, B);
    const commB = prover.commitMatrix('B-ser', B);
    const commC = prover.commitMatrix('C-ser', C);

    expect(() => prover.multiplyMatrices([[1n]], [[2n], [3n]])).toThrow();

    const proof = prover.proveMatrixProduct('matmul-ser', A, commB, commC, 2);
    const json = prover.serializeProof(proof);
    const restored = prover.deserializeProof(json);
    expect(restored).toEqual(proof);
    expect(prover.verifyMatrixProduct(restored).valid).toBe(true);
  });
});
