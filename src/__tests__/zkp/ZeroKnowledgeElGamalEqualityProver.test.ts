import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeElGamalEqualityProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeElGamalEqualityProver';

describe('ZeroKnowledgeElGamalEqualityProver', () => {
  const prover = new ZeroKnowledgeElGamalEqualityProver();

  it('proves cross-key ElGamal plaintext equality and offset relations', () => {
    const alice = prover.generateKeyPair();
    const bob = prover.generateKeyPair();
    const charlie = prover.generateKeyPair();

    const w1 = prover.encrypt(alice.publicKey, 1337n);
    const w2 = prover.encrypt(bob.publicKey, 1337n);
    const w3 = prover.encrypt(charlie.publicKey, 1337n);
    const wOffset = prover.encrypt(bob.publicKey, 1437n);

    expect(prover.decryptGroupElement(alice.secretKey, w1.ciphertext)).toBe(
      prover.decryptGroupElement(bob.secretKey, w2.ciphertext),
    );

    const eqProof = prover.provePlaintextRelation(w1, w2, 0n, 'escrow-sync');
    expect(prover.verifyPlaintextRelation(eqProof)).toBe(true);

    const offsetProof = prover.provePlaintextRelation(w1, wOffset, 100n, 'fee-offset');
    expect(prover.verifyPlaintextRelation(offsetProof)).toBe(true);
    expect(prover.verifyPlaintextRelation({ ...offsetProof, offsetDelta: 99n })).toBe(false);

    const chain = prover.proveMultiRecipientEquivalence([w1, w2, w3], 'audit-broadcast');
    expect(prover.verifyBatch(chain)).toEqual({ allValid: true, failedIndices: [] });

    const json = JSON.parse(prover.serializeProof(eqProof)) as { context: string; offsetDelta: string };
    expect(json.context).toBe('escrow-sync');
    expect(json.offsetDelta).toBe('0');
  });

  it('rejects every single tampered field and invalid witness relation', () => {
    const alice = prover.generateKeyPair();
    const bob = prover.generateKeyPair();
    const w1 = prover.encrypt(alice.publicKey, 500n);
    const w2 = prover.encrypt(bob.publicKey, 500n);
    const wDiff = prover.encrypt(bob.publicKey, 501n);

    expect(() => prover.provePlaintextRelation(w1, wDiff, 0n)).toThrow();
    expect(() => prover.proveMultiRecipientEquivalence([w1])).toThrow();

    const proof = prover.provePlaintextRelation(w1, w2, 0n, 'strict-tamper');
    expect(prover.verifyPlaintextRelation(proof)).toBe(true);

    const rerand = prover.rerandomize(bob.publicKey, w2.ciphertext);
    expect(prover.verifyPlaintextRelation({ ...proof, ct2: rerand.ciphertext })).toBe(false);
    expect(prover.verifyPlaintextRelation({ ...proof, ct1: { ...proof.ct1, c1: (proof.ct1.c1 * 4n) % SAFE_PRIME_P } })).toBe(false);
    expect(prover.verifyPlaintextRelation({ ...proof, publicKey1: bob.publicKey })).toBe(false);
    expect(prover.verifyPlaintextRelation({ ...proof, publicKey2: alice.publicKey })).toBe(false);
    expect(prover.verifyPlaintextRelation({ ...proof, announceA1: (proof.announceA1 * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(prover.verifyPlaintextRelation({ ...proof, announceB2: (proof.announceB2 * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(prover.verifyPlaintextRelation({ ...proof, challenge: (proof.challenge + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyPlaintextRelation({ ...proof, responseM: (proof.responseM + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyPlaintextRelation({ ...proof, responseR1: (proof.responseR1 + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyPlaintextRelation({ ...proof, responseR2: (proof.responseR2 + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyPlaintextRelation({ ...proof, context: 'wrong-domain' })).toBe(false);
  });

  it('handles zero plaintext, negative modular offsets, and batch fault indexing', () => {
    const k1 = prover.generateKeyPair(1234567n);
    const k2 = prover.generateKeyPair(7654321n);
    const wZero1 = prover.encrypt(k1.publicKey, 0n);
    const wZero2 = prover.encrypt(k2.publicKey, 0n);
    const zeroProof = prover.provePlaintextRelation(wZero1, wZero2, 0n, 'zero-balance');
    expect(prover.verifyPlaintextRelation(zeroProof)).toBe(true);

    const wA = prover.encrypt(k1.publicKey, 250n);
    const wB = prover.encrypt(k2.publicKey, 200n);
    const negOffsetProof = prover.provePlaintextRelation(wA, wB, SUBGROUP_Q - 50n, 'discount-50');
    expect(prover.verifyPlaintextRelation(negOffsetProof)).toBe(true);

    const corrupted = { ...negOffsetProof, responseM: (negOffsetProof.responseM + 7n) % SUBGROUP_Q };
    const report = prover.verifyBatch([zeroProof, corrupted, negOffsetProof]);
    expect(report).toEqual({ allValid: false, failedIndices: [1] });
  });
});
