import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeSetDifferenceProver } from '../../core/zkp/ZeroKnowledgeSetDifferenceProver';

describe('ZeroKnowledgeSetDifferenceProver', () => {
  const prover = new ZeroKnowledgeSetDifferenceProver();

  it('proves and verifies constant-size Bezout disjointness and subset inclusion proofs', () => {
    const setA = prover.commitSet('team-east', ['alice', 'bob', 'carol']);
    const setB = prover.commitSet('team-west', ['dave', 'eve']);
    const setSub = prover.commitSet('team-east-sub', ['alice', 'carol']);

    const disjointProof = prover.proveDisjointness(setA, setB);
    expect(prover.verifyDisjointness(disjointProof)).toBe(true);
    expect(prover.verifyDisjointness({ ...disjointProof, bezoutA: disjointProof.bezoutA + 1n })).toBe(false);

    // Non-disjoint sets must throw
    expect(() => prover.proveDisjointness(setA, setSub)).toThrow();

    const subsetProof = prover.proveSubset(setSub, setA);
    expect(prover.verifySubset(subsetProof)).toBe(true);
    expect(prover.verifySubset({ ...subsetProof, quotientWitness: subsetProof.quotientWitness + 1n })).toBe(false);
    expect(() => prover.proveSubset(setB, setA)).toThrow();
  });

  it('proves and verifies exact set difference (M \\ S) against committed accumulators', () => {
    const minuend = ['perm-read', 'perm-write', 'perm-audit', 'perm-deploy', 'perm-admin'];
    const subtrahend = ['perm-audit', 'perm-admin', 'perm-billing'];

    const mCommit = prover.commitSet('role-all', minuend);
    const sCommit = prover.commitSet('role-revoked', subtrahend);

    const diffProof = prover.proveSetDifference('role-all', minuend, 'role-revoked', subtrahend);
    expect(diffProof.differenceElements).toEqual(['perm-deploy', 'perm-read', 'perm-write']);
    expect(prover.verifySetDifference(diffProof, mCommit.accumulator, sCommit.accumulator).valid).toBe(true);

    // Forging difference elements (omitting or altering an element) must fail verification
    expect(
      prover.verifySetDifference(
        { ...diffProof, differenceElements: ['perm-deploy', 'perm-read'] },
        mCommit.accumulator,
        sCommit.accumulator
      ).valid
    ).toBe(false);

    // Wrong minuend commitment must fail
    expect(
      prover.verifySetDifference(diffProof, mCommit.accumulator + 1n, sCommit.accumulator).valid
    ).toBe(false);
  });

  it('handles empty difference and round-trips JSON proof serialization', () => {
    const m = ['a', 'b'];
    const s = ['a', 'b', 'c'];
    const mCommit = prover.commitSet('m-empty', m);
    const sCommit = prover.commitSet('s-super', s);

    const emptyDiff = prover.proveSetDifference('m-empty', m, 's-super', s);
    expect(emptyDiff.differenceElements).toEqual([]);
    expect(prover.verifySetDifference(emptyDiff, mCommit.accumulator, sCommit.accumulator).valid).toBe(true);

    const json = prover.serializeDifferenceProof(emptyDiff);
    const restored = prover.deserializeDifferenceProof(json);
    expect(restored).toEqual(emptyDiff);
    expect(prover.verifySetDifference(restored, mCommit.accumulator, sCommit.accumulator).valid).toBe(true);
  });
});
