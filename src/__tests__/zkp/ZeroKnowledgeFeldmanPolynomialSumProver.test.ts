import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeFeldmanPolynomialSumProver } from '../../core/zkp/ZeroKnowledgeFeldmanPolynomialSumProver';

describe('ZeroKnowledgeFeldmanPolynomialSumProver', () => {
  const prover = new ZeroKnowledgeFeldmanPolynomialSumProver();

  it('homomorphically sums K dealer Feldman polynomials and verifies aggregate evaluations', () => {
    const dealers = ['d1', 'd2', 'd3', 'd4'].map((id) => prover.createDealerPolynomial(id, 3));
    const summary = prover.aggregateDealerCommitments('sum-poly-2026', dealers);

    const evalPoints = [1n, 2n, 3n, 4n].map((x) => {
      const res = prover.computeVerifiedAggregateEval(summary, dealers, x);
      expect(prover.verifyPointConsistency(summary, res.proof)).toBe(true);
      expect(prover.verifyPointConsistency(summary, { ...res.proof, claimedEvalY: res.evalY + 1n })).toBe(false);
      return { x, evalCommit: res.proof.expectedEvalCommit, proof: res.proof };
    });

    // Any 4 (degree+1) verified evaluation commitments must interpolate to aggregateConstantPub
    expect(prover.verifyLagrangeConstantTerm(summary, evalPoints)).toBe(true);

    const json = prover.serializeProof(evalPoints[0].proof);
    const restored = prover.deserializeProof(json);
    expect(restored).toEqual(evalPoints[0].proof);
    expect(prover.verifyPointConsistency(summary, restored)).toBe(true);
  });
});
