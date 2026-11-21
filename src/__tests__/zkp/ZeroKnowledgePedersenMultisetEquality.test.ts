import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePedersenMultisetEquality, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgePedersenMultisetEquality';

describe('ZeroKnowledgePedersenMultisetEquality', () => {
  const engine = new ZeroKnowledgePedersenMultisetEquality();

  it('proves equality of reordered multisets with duplicate multiplicities in zero knowledge', () => {
    const setA = engine.commitMultiset([7n, 3n, 7n, 15n, 3n, 42n]);
    const setB = engine.commitMultiset([42n, 3n, 7n, 3n, 15n, 7n]);

    const proof = engine.proveMultisetEquality(setA, setB, 'orderbook-reconcile');
    expect(engine.verifyMultisetEquality(proof)).toBe(true);

    // Same distinct elements with DIFFERENT multiplicities {7,7,3} vs {7,3,3} MUST throw!
    const m1 = engine.commitMultiset([7n, 7n, 3n]);
    const m2 = engine.commitMultiset([7n, 3n, 3n]);
    expect(() => engine.proveMultisetEquality(m1, m2)).toThrow();

    // Tampered commitment, gate response, or final equality response fails verification
    expect(
      engine.verifyMultisetEquality({
        ...proof,
        commitmentsB: [(proof.commitmentsB[0] * 4n) % SAFE_PRIME_P, ...proof.commitmentsB.slice(1)],
      }),
    ).toBe(false);
    expect(engine.verifyMultisetEquality({ ...proof, finalEqResponseR: (proof.finalEqResponseR + 1n) % SUBGROUP_Q })).toBe(false);
    expect(
      engine.verifyMultisetEquality({
        ...proof,
        gatesA: proof.gatesA.map((g, i) => (i === 0 ? { ...g, respRightVal: (g.respRightVal + 1n) % SUBGROUP_Q } : g)),
      }),
    ).toBe(false);

    // Single-element multiset boundary case
    const sA = engine.commitMultiset([99n]);
    const sB = engine.commitMultiset([99n]);
    expect(engine.verifyMultisetEquality(engine.proveMultisetEquality(sA, sB, 'solo'))).toBe(true);

    const json = JSON.parse(engine.serializeProof(proof)) as { size: number; context: string };
    expect(json.size).toBe(6);
    expect(json.context).toBe('orderbook-reconcile');
  });
});
