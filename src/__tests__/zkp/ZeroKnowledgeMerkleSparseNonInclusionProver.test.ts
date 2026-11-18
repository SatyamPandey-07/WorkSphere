import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleSparseNonInclusionProver } from '../../core/zkp/ZeroKnowledgeMerkleSparseNonInclusionProver';

describe('ZeroKnowledgeMerkleSparseNonInclusionProver', () => {
  it('generates compact bitmap inclusion and non-inclusion proofs over a 256-bit keyspace', () => {
    const smt = new ZeroKnowledgeMerkleSparseNonInclusionProver();
    expect(smt.getRootHash()).toBe(smt.getDefaultEmptyRoot());

    smt.set('user:alice', 'role=admin');
    smt.set('user:bob', 'role=editor');
    const root = smt.set('user:carol', 'role=viewer');

    const incAlice = smt.generateProof('user:alice');
    const nonIncMallory = smt.generateProof('user:mallory');

    expect(incAlice.included).toBe(true);
    expect(incAlice.value).toBe('role=admin');
    expect(incAlice.nonDefaultSiblings.length).toBeLessThan(16); // Bitmap compression!
    expect(smt.verifyProof(incAlice, root).valid).toBe(true);

    expect(nonIncMallory.included).toBe(false);
    expect(nonIncMallory.value).toBeNull();
    expect(smt.verifyProof(nonIncMallory, root).valid).toBe(true);

    // Forged value or forged non-inclusion must fail
    expect(smt.verifyProof({ ...incAlice, value: 'role=superadmin' }, root).valid).toBe(false);
    expect(smt.verifyProof({ ...nonIncMallory, included: true, value: 'fake' }, root).valid).toBe(false);
  });

  it('verifies atomic insert, update, and delete state-root transitions and restores empty root', () => {
    const smt = new ZeroKnowledgeMerkleSparseNonInclusionProver();
    const tInsert = smt.applyVerifiedTransition('quota:eng', '500');
    expect(smt.verifyStateTransition(tInsert).valid).toBe(true);
    expect(tInsert.oldValue).toBeNull();
    expect(tInsert.newValue).toBe('500');

    const tUpdate = smt.applyVerifiedTransition('quota:eng', '750');
    expect(smt.verifyStateTransition(tUpdate).valid).toBe(true);
    expect(tUpdate.oldRootHash).toBe(tInsert.newRootHash);

    const tDelete = smt.applyVerifiedTransition('quota:eng', null);
    expect(smt.verifyStateTransition(tDelete).valid).toBe(true);
    expect(tDelete.newRootHash).toBe(smt.getDefaultEmptyRoot());

    // Tampered transition claiming a different post-root must fail
    expect(smt.verifyStateTransition({ ...tUpdate, newRootHash: '0'.repeat(64) }).valid).toBe(false);
  });

  it('batch-verifies mixed inclusion/non-inclusion proofs and round-trips serialization', () => {
    const smt = new ZeroKnowledgeMerkleSparseNonInclusionProver();
    smt.set('k1', 'v1');
    const root = smt.set('k2', 'v2');

    const p1 = smt.generateProof('k1');
    const pMissing = smt.generateProof('k-absent');
    const batch = smt.batchVerifyProofs([p1, pMissing], root);
    expect(batch.allValid).toBe(true);
    expect(batch.includedKeys).toEqual(['k1']);
    expect(batch.excludedKeys).toEqual(['k-absent']);

    const json = smt.serializeProof(pMissing);
    const restored = smt.deserializeProof(json);
    expect(restored).toEqual(pMissing);
    expect(smt.verifyProof(restored, root).valid).toBe(true);
  });
});
