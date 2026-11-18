import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePolynomialCommitBatch, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgePolynomialCommitBatch';

describe('ZeroKnowledgePolynomialCommitBatch', () => {
  const prover = new ZeroKnowledgePolynomialCommitBatch();

  it('batches multi-polynomial Pedersen openings via Fiat-Shamir folding and quotient verification', () => {
    const p1 = prover.commitPolynomial('poly-a', [5n, 3n, 7n, 2n]);
    const p2 = prover.commitPolynomial('poly-b', [11n, 0n, 4n]);
    const p3 = prover.commitPolynomial('poly-c', [1n, 9n, 2n, 6n, 1n]);

    const z = 13n;
    const proof = prover.proveBatchOpening([p1, p2, p3], z, 'plonk-round-3');
    expect(proof.claimedEvaluations[0]).toBe(5n + 3n * 13n + 7n * 169n + 2n * 2197n);
    expect(proof.claimedEvaluations[1]).toBe(11n + 4n * 169n);
    expect(prover.verifyBatchOpening(proof)).toBe(true);

    const serialized = JSON.parse(prover.serializeProof(proof)) as { polyCount: number; evalPointZ: string };
    expect(serialized.polyCount).toBe(3);
    expect(serialized.evalPointZ).toBe('13');
  });

  it('handles degree-0 constant polynomials, evaluation at z=0, and exact synthetic division', () => {
    const constant = prover.commitPolynomial('const-only', [42n]);
    const linear = prover.commitPolynomial('linear', [10n, 7n]);

    const proofAtZero = prover.proveBatchOpening([constant, linear], 0n, 'origin-eval');
    expect(proofAtZero.claimedEvaluations).toEqual([42n, 10n]);
    expect(prover.verifyBatchOpening(proofAtZero)).toBe(true);

    const proofConstOnly = prover.proveBatchOpening([constant], 99n, 'const-check');
    expect(proofConstOnly.claimedEvaluations).toEqual([42n]);
    expect(prover.verifyBatchOpening(proofConstOnly)).toBe(true);

    const div = prover.divideByLinearFactor([modCheck(-6n), 11n, modCheck(-6n), 1n], 2n); // (x-1)(x-2)(x-3)
    expect(div.remainder).toBe(0n);
  });

  it('rejects empty inputs and every possible tampered field in batch opening proofs', () => {
    expect(() => prover.commitPolynomial('empty', [])).toThrow();
    expect(() => prover.proveBatchOpening([], 5n)).toThrow();

    const p1 = prover.commitPolynomial('p1', [2n, 4n, 6n]);
    const p2 = prover.commitPolynomial('p2', [9n, 1n, 3n, 5n]);
    const proof = prover.proveBatchOpening([p1, p2], 7n, 'tamper-audit');
    expect(prover.verifyBatchOpening(proof)).toBe(true);

    const badClaim = [...proof.claimedEvaluations];
    badClaim[1] += 1n;
    expect(prover.verifyBatchOpening({ ...proof, claimedEvaluations: badClaim })).toBe(false);

    const badQ = [...proof.quotientCommitments];
    badQ[0] = (badQ[0] * 4n) % SAFE_PRIME_P;
    expect(prover.verifyBatchOpening({ ...proof, quotientCommitments: badQ })).toBe(false);

    expect(prover.verifyBatchOpening({ ...proof, evalPointZ: 8n })).toBe(false);
    expect(prover.verifyBatchOpening({ ...proof, foldingGamma: (proof.foldingGamma + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyBatchOpening({ ...proof, checkPointBeta: (proof.checkPointBeta + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyBatchOpening({ ...proof, fiatShamirChallenge: (proof.fiatShamirChallenge + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyBatchOpening({ ...proof, evalResponseBlinding: (proof.evalResponseBlinding + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyBatchOpening({ ...proof, identityResponseBlinding: (proof.identityResponseBlinding + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyBatchOpening({ ...proof, context: 'wrong-ctx' })).toBe(false);
    expect(prover.verifyBatchOpening({ ...proof, polyCommitments: [] })).toBe(false);
  });
});

function modCheck(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}
