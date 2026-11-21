import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePedersenMultisetHash } from '../../core/zkp/ZeroKnowledgePedersenMultisetHash';

describe('ZeroKnowledgePedersenMultisetHash', () => {
  it('computes order-independent MuHash digests supporting O(1) insert, remove, and delta proofs', () => {
    const mh1 = new ZeroKnowledgePedersenMultisetHash('ws-utxo');
    const mh2 = new ZeroKnowledgePedersenMultisetHash('ws-utxo');

    mh1.insert('a');
    mh1.insert('b', 2);
    mh1.insert('c');

    mh2.insert('c');
    mh2.insert('a');
    mh2.insert('b');
    mh2.insert('b');

    expect(mh1.getDigest()).toBe(mh2.getDigest());
    expect(mh1.getMultiplicity('b')).toBe(2);

    const delta = mh1.applyDeltaTransition('delta-1', ['d', 'e'], ['b']);
    expect(mh1.verifyDeltaTransition(delta)).toBe(true);
    expect(mh1.verifyDeltaTransition({ ...delta, addedElements: ['d', 'forged'] })).toBe(false);
    expect(mh1.getMultiplicity('b')).toBe(1);
  });

  it('proves blinded multiset equivalence in zero knowledge and round-trips serialization', () => {
    const mh = new ZeroKnowledgePedersenMultisetHash('ws-eq');
    const cA = mh.createBlindedCommitment(['x', 'y', 'z', 'x']);
    const cB = mh.createBlindedCommitment(['z', 'x', 'x', 'y']);
    const cDiff = mh.createBlindedCommitment(['x', 'y', 'z']);

    expect(cA.commitment).not.toBe(cB.commitment);
    const eqProof = mh.proveBlindedEquivalence('eq-1', cA, cB);
    expect(mh.verifyBlindedEquivalence(eqProof)).toBe(true);
    expect(mh.verifyBlindedEquivalence({ ...eqProof, responseDeltaR: eqProof.responseDeltaR + 1n })).toBe(false);
    expect(() => mh.proveBlindedEquivalence('eq-bad', cA, cDiff)).toThrow();

    const json = mh.serializeEquivalenceProof(eqProof);
    const restored = mh.deserializeEquivalenceProof(json);
    expect(restored).toEqual(eqProof);
    expect(mh.verifyBlindedEquivalence(restored)).toBe(true);
  });
});
