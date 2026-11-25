import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeInnerProductFoldingProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeInnerProductFoldingProver';

describe('ZeroKnowledgeInnerProductFoldingProver', () => {
  const prover = new ZeroKnowledgeInnerProductFoldingProver();

  it('folds 8-dimensional inner products in 3 logarithmic rounds and verifies opening', () => {
    const basis = prover.createBasis(8, 'bp-ipa-8');
    const a = [3n, 5n, 7n, 2n, 11n, 4n, 9n, 6n];
    const b = [2n, 8n, 1n, 10n, 3n, 6n, 5n, 4n];

    const proof = prover.prove(basis, a, b, 'range-eval-1');
    expect(proof.rounds.length).toBe(3);
    expect(proof.claimedInnerProduct).toBe(prover.innerProduct(a, b));
    expect(prover.verify(basis, proof)).toBe(true);

    const meta = JSON.parse(prover.serializeProof(proof)) as { dimension: number; roundCount: number };
    expect(meta.dimension).toBe(8);
    expect(meta.roundCount).toBe(3);
  });

  it('handles dimensions 1, 2, 4, and 16 including orthogonal zero-product vectors', () => {
    for (const dim of [1, 2, 4, 16]) {
      const basis = prover.createBasis(dim, `dim-${dim}`);
      const { a, b } = prover.generateRandomVectors(dim);
      const proof = prover.prove(basis, a, b, `ctx-${dim}`);
      expect(proof.rounds.length).toBe(Math.log2(dim));
      expect(prover.verify(basis, proof)).toBe(true);
    }

    // Orthogonal vectors: <a, b> == 0
    const b4 = prover.createBasis(4, 'orth-4');
    const pOrth = prover.prove(b4, [1n, 0n, 2n, 0n], [0n, 9n, 0n, 7n], 'orth');
    expect(pOrth.claimedInnerProduct).toBe(0n);
    expect(prover.verify(b4, pOrth)).toBe(true);
  });

  it('rejects non-power-of-2 dimensions, tampered cross-terms, and wrong final scalars', () => {
    expect(() => prover.createBasis(0)).toThrow();
    expect(() => prover.createBasis(3)).toThrow();
    expect(() => prover.createBasis(6)).toThrow();

    const basis = prover.createBasis(4, 'strict-4');
    expect(() => prover.prove(basis, [1n, 2n], [1n, 2n])).toThrow();

    const p1 = prover.prove(basis, [4n, 8n, 2n, 6n], [1n, 3n, 5n, 7n], 's1');
    const p2 = prover.prove(basis, [9n, 1n, 3n, 2n], [2n, 2n, 4n, 8n], 's2');
    expect(prover.verifyBatch(basis, [p1, p2])).toEqual({ allValid: true, failedIndices: [] });

    expect(prover.verify(basis, { ...p1, finalA: (p1.finalA + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verify(basis, { ...p1, finalB: (p1.finalB + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verify(basis, { ...p1, context: 'wrong' })).toBe(false);
    expect(prover.verify(basis, { ...p1, commitmentP: (p1.commitmentP * 4n) % SAFE_PRIME_P })).toBe(false);
    const badRounds = p1.rounds.map((r, i) => (i === 0 ? { ...r, L: (r.L * 4n) % SAFE_PRIME_P } : r));
    expect(prover.verify(basis, { ...p1, rounds: badRounds })).toBe(false);

    expect(prover.verifyBatch(basis, [p1, { ...p2, finalA: (p2.finalA + 2n) % SUBGROUP_Q }])).toEqual({
      allValid: false,
      failedIndices: [1],
    });
  });
});
