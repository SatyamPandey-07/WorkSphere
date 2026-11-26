import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeQuadraticConstraintProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeQuadraticConstraintProver';

describe('ZeroKnowledgeQuadraticConstraintProver', () => {
  const prover = new ZeroKnowledgeQuadraticConstraintProver();

  it('proves quadratic polynomial relations in zero knowledge and verifies chained constraint pipelines', () => {
    // 3x^2 + 5x + 7 = y; for x = 4 -> 48 + 20 + 7 = 75
    const eq = { id: 'poly-curve-1', a: 3n, b: 5n, c: 7n };
    const xComm = prover.commitScalar(4n);
    const { proof, yCommitted } = prover.proveConstraint(eq, xComm, undefined, 'curve-check');

    expect(yCommitted.value).toBe(75n);
    expect(prover.verifyConstraint(proof)).toBe(true);

    // Prove zero-root quadratic x^2 - 7x + 12 = 0 for x = 3
    const rootEq = { id: 'root-check', a: 1n, b: -7n, c: 12n };
    const yZero = prover.commitScalar(0n);
    const { proof: rootProof } = prover.proveConstraint(rootEq, prover.commitScalar(3n), yZero, 'root-3');
    expect(prover.verifyConstraint(rootProof)).toBe(true);

    // Chained multi-stage quadratic composition: y1 = x^2 + 1, y2 = 2*y1^2 + 3*y1 + 5
    const chain = prover.proveChainedSystem(
      [
        { id: 'stage-1', a: 1n, b: 0n, c: 1n },
        { id: 'stage-2', a: 2n, b: 3n, c: 5n },
        { id: 'stage-3', a: 1n, b: 1n, c: 0n },
      ],
      6n,
      'pipeline',
    );
    expect(prover.verifyBatch(chain, true)).toEqual({ allValid: true, verifiedCount: 3, failedEquationIds: [] });

    const json = JSON.parse(prover.serializeProof(proof)) as { equationId: string; a: string };
    expect(json.equationId).toBe('poly-curve-1');
    expect(json.a).toBe('3');
  });

  it('rejects inconsistent y commitments, broken chain links, and tampered proof fields', () => {
    const eq = { id: 'eq-strict', a: 2n, b: 4n, c: 1n };
    const xComm = prover.commitScalar(5n);
    expect(() => prover.proveConstraint(eq, xComm, prover.commitScalar(999n))).toThrow();
    expect(() => prover.proveChainedSystem([], 1n)).toThrow();

    const { proof } = prover.proveConstraint(eq, xComm, undefined, 'strict');
    expect(prover.verifyConstraint(proof)).toBe(true);

    expect(prover.verifyConstraint({ ...proof, commY: (proof.commY * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(prover.verifyConstraint({ ...proof, commXSq: (proof.commXSq * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(prover.verifyConstraint({ ...proof, respX: (proof.respX + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyConstraint({ ...proof, respRDelta: (proof.respRDelta + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyConstraint({ ...proof, respRLin: (proof.respRLin + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyConstraint({ ...proof, equation: { ...proof.equation, c: 2n } })).toBe(false);
    expect(prover.verifyConstraint({ ...proof, context: 'wrong' })).toBe(false);

    // Chain link check fails when two valid independent proofs are not linked (commY_0 != commX_1)
    const pA = prover.proveConstraint(eq, prover.commitScalar(2n), undefined, 'a').proof;
    const pB = prover.proveConstraint({ id: 'eq-2', a: 1n, b: 1n, c: 1n }, prover.commitScalar(9n), undefined, 'b').proof;
    expect(prover.verifyBatch([pA, pB], false).allValid).toBe(true);
    expect(prover.verifyBatch([pA, pB], true)).toEqual({ allValid: false, verifiedCount: 1, failedEquationIds: ['eq-2'] });
  });
});
