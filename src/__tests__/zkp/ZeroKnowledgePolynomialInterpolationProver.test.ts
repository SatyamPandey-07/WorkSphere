import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePolynomialInterpolationProver } from '../../core/zkp/ZeroKnowledgePolynomialInterpolationProver';

describe('ZeroKnowledgePolynomialInterpolationProver', () => {
  const prover = new ZeroKnowledgePolynomialInterpolationProver();

  it('interpolates a unique Lagrange polynomial and proves zero-knowledge point evaluations', () => {
    const points = [
      { x: 1n, y: 12n },
      { x: 2n, y: 27n },
      { x: 3n, y: 50n },
      { x: 4n, y: 81n },
    ];
    const committed = prover.interpolateAndCommit('poly-quota-curve', points);
    expect(committed.degree).toBe(3);

    for (const pt of points) {
      expect(prover.evaluatePolynomial(committed.coefficients, pt.x)).toBe(pt.y);
      const proof = prover.proveEvaluation(committed, pt.x);
      expect(proof.y).toBe(pt.y);
      expect(prover.verifyEvaluation(committed.commitments, proof)).toBe(true);
    }

    const pEval = prover.proveEvaluation(committed, 7n);
    expect(prover.verifyEvaluation(committed.commitments, pEval)).toBe(true);
    expect(prover.verifyEvaluation(committed.commitments, { ...pEval, y: pEval.y + 1n })).toBe(false);
    expect(
      prover.verifyEvaluation(committed.commitments, {
        ...pEval,
        responseBlinding: pEval.responseBlinding + 1n,
      })
    ).toBe(false);
  });

  it('produces and verifies constant-size batched multi-point proofs and homomorphic polynomial sums', () => {
    const polyA = prover.commitPolynomial('poly-A', [5n, 3n, 2n]);
    const polyB = prover.commitPolynomial('poly-B', [7n, 1n, 4n]);

    const batchProof = prover.proveBatchEvaluations(polyA, [1n, 2n, 5n, 9n]);
    expect(prover.verifyBatchEvaluations(polyA.commitments, batchProof)).toBe(true);

    const forgedBatch = {
      ...batchProof,
      points: [{ x: batchProof.points[0].x, y: batchProof.points[0].y + 1n }, ...batchProof.points.slice(1)],
    };
    expect(prover.verifyBatchEvaluations(polyA.commitments, forgedBatch)).toBe(false);

    // Homomorphic commitment addition matches P_A(x) + P_B(x)
    const sumCommit = prover.homomorphicAddCommitments(polyA.commitments, polyB.commitments);
    const evalSumC = prover.evaluateCommitmentAt(sumCommit, 3n);
    const evalA = prover.evaluateCommitmentAt(polyA.commitments, 3n);
    const evalB = prover.evaluateCommitmentAt(polyB.commitments, 3n);
    const p = 0xffffffffffffffffffffffffffffc3a7n;
    expect(evalSumC).toBe((evalA * evalB) % p);
  });

  it('rejects duplicate interpolation points and round-trips batch proof serialization', () => {
    expect(() =>
      prover.interpolateLagrange([
        { x: 2n, y: 5n },
        { x: 2n, y: 6n },
      ])
    ).toThrow();

    const committed = prover.commitPolynomial('poly-ser', [11n, 22n, 33n]);
    const batch = prover.proveBatchEvaluations(committed, [2n, 4n, 6n]);
    const json = prover.serializeBatchProof(batch);
    const restored = prover.deserializeBatchProof(json);
    expect(restored).toEqual(batch);
    expect(prover.verifyBatchEvaluations(committed.commitments, restored)).toBe(true);
  });
});
