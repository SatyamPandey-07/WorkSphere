import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerklePatriciaTrieProver } from '../../core/zkp/ZeroKnowledgeMerklePatriciaTrieProver';

describe('ZeroKnowledgeMerklePatriciaTrieProver', () => {
  it('stores key-value state in a radix-16 MPT and verifies inclusion and non-inclusion proofs', () => {
    const mpt = new ZeroKnowledgeMerklePatriciaTrieProver();
    const root = mpt.setBatch([
      ['acct:alice', 'balance=1000'],
      ['acct:bob', 'balance=2500'],
      ['acct:carol', 'balance=500'],
      ['acct:dave', 'balance=750'],
      ['acct:eve', 'balance=4200'],
    ]);

    expect(mpt.getEntryCount()).toBe(5);
    expect(mpt.get('acct:bob')).toBe('balance=2500');

    const pAlice = mpt.generateProof('acct:alice');
    const pEve = mpt.generateProof('acct:eve');
    const pAbsent = mpt.generateProof('acct:mallory');

    expect(pAlice.included).toBe(true);
    expect(pAlice.value).toBe('balance=1000');
    expect(pAbsent.included).toBe(false);
    expect(pAbsent.value).toBeNull();

    const batch = mpt.batchVerifyProofs([pAlice, pEve, pAbsent], root);
    expect(batch.allValid).toBe(true);
    expect(batch.validCount).toBe(3);

    // Forged value or forged inclusion must fail
    expect(mpt.verifyProof({ ...pAlice, value: 'balance=999999' }, root).valid).toBe(false);
    expect(mpt.verifyProof({ ...pAbsent, included: true, value: 'balance=1' }, root).valid).toBe(false);

    const json = mpt.serializeProof(pAlice);
    const restored = mpt.deserializeProof(json);
    expect(restored).toEqual(pAlice);
    expect(mpt.verifyProof(restored, root).valid).toBe(true);
  });
});
