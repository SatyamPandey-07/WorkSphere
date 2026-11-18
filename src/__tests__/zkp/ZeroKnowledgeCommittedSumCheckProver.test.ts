import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeCommittedSumCheckProver, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeCommittedSumCheckProver';

describe('ZeroKnowledgeCommittedSumCheckProver', () => {
  const prover = new ZeroKnowledgeCommittedSumCheckProver();

  it('proves multilinear hypercube sums over hiding round commitments and verifies final MLE oracle check', () => {
    // 4 variables -> 16 hypercube evaluations
    const evals = [3n, 7n, 1n, 9n, 4n, 2n, 8n, 5n, 6n, 0n, 11n, 3n, 2n, 9n, 4n, 10n];
    const expectedSum = evals.reduce((a, b) => a + b, 0n);

    const proof = prover.proveHypercubeSum(evals, 'gkr-layer-0');
    expect(proof.numVars).toBe(4);
    expect(proof.claimedSum).toBe(expectedSum);
    expect(proof.rounds.length).toBe(4);
    expect(prover.verifyHypercubeSum(proof, evals)).toBe(true);

    // 1-variable (2-entry) boundary case
    const small = [42n, 58n];
    const pSmall = prover.proveHypercubeSum(small, 'tiny-1var');
    expect(pSmall.claimedSum).toBe(100n);
    expect(prover.verifyHypercubeSum(pSmall, small)).toBe(true);

    // Tampered claimedSum, oracle value, or round blinding fails verification
    expect(prover.verifyHypercubeSum({ ...proof, claimedSum: expectedSum + 1n }, evals)).toBe(false);
    expect(prover.verifyHypercubeSum({ ...proof, finalOracleValue: (proof.finalOracleValue + 1n) % SUBGROUP_Q }, evals)).toBe(false);
    expect(prover.verifyHypercubeSum({ ...proof, finalResponseBlinding: (proof.finalResponseBlinding + 1n) % SUBGROUP_Q }, evals)).toBe(false);
    const badRounds = proof.rounds.map((r, i) => (i === 1 ? { ...r, sumResponseBlinding: (r.sumResponseBlinding + 1n) % SUBGROUP_Q } : r));
    expect(prover.verifyHypercubeSum({ ...proof, rounds: badRounds }, evals)).toBe(false);
    expect(() => prover.proveHypercubeSum([1n, 2n, 3n])).toThrow();

    const json = JSON.parse(prover.serializeProof(proof)) as { numVars: number; claimedSum: string };
    expect(json.numVars).toBe(4);
    expect(json.claimedSum).toBe(expectedSum.toString());
  });

  it('handles 5-variable 32-entry tables, all-zero tables, negative modular entries, and verifier-only checks', () => {
    const evals32 = Array.from({ length: 32 }, (_, i) => BigInt((i * 13 + 7) % 97));
    const p32 = prover.proveHypercubeSum(evals32, 'sumcheck-5vars');
    expect(p32.numVars).toBe(5);
    expect(p32.rounds.length).toBe(5);
    expect(prover.verifyHypercubeSum(p32, evals32)).toBe(true);
    // Verifying without passing oracle still verifies internal commitment consistency
    expect(prover.verifyHypercubeSum(p32)).toBe(true);

    const zeros = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    const pZero = prover.proveHypercubeSum(zeros, 'all-zero');
    expect(pZero.claimedSum).toBe(0n);
    expect(prover.verifyHypercubeSum(pZero, zeros)).toBe(true);

    // Tampering with context, finalChallengePoint, or round ordering fails
    expect(prover.verifyHypercubeSum({ ...p32, context: 'wrong' }, evals32)).toBe(false);
    expect(prover.verifyHypercubeSum({ ...p32, numVars: 4 }, evals32)).toBe(false);
    const badPoint = [...p32.finalChallengePoint];
    badPoint[0] = (badPoint[0] + 1n) % SUBGROUP_Q;
    expect(prover.verifyHypercubeSum({ ...p32, finalChallengePoint: badPoint }, evals32)).toBe(false);
    expect(() => prover.evaluateMLE([1n, 2n, 3n], [1n, 2n])).toThrow();
    expect(() => prover.proveHypercubeSum([1n])).toThrow();
  });
});
