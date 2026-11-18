import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeAccumulatorBatchDelete, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeAccumulatorBatchDelete';

describe('ZeroKnowledgeAccumulatorBatchDelete', () => {
  it('supports ZK membership proofs, atomic batch deletion, and O(1) surviving witness updates', () => {
    const acc = new ZeroKnowledgeAccumulatorBatchDelete();
    const s1 = acc.addBatch(['cred-a', 'cred-b', 'cred-c', 'cred-d', 'cred-e']);
    expect(s1.addedCount).toBe(5);
    expect(acc.getState().size).toBe(5);

    const wA = acc.issueWitness('cred-a');
    const wC = acc.issueWitness('cred-c');
    expect(acc.verifyWitnessWithTrapdoor(wA, s1.accumulator)).toBe(true);

    const zkProof = acc.proveMembershipZK(wA, s1.accumulator, 'login-session-1');
    expect(acc.verifyMembershipZK(zkProof)).toBe(true);
    expect(acc.verifyMembershipZK({ ...zkProof, element: 'cred-z' })).toBe(false);

    const delProof = acc.deleteBatch(['cred-b', 'cred-d']);
    expect(acc.verifyBatchDeletion(delProof)).toBe(true);
    expect(acc.verifyBatchDeletion({ ...delProof, newEpoch: 99 })).toBe(false);
    expect(acc.getState().size).toBe(3);

    const updatedWC = acc.updateWitnessAfterDeletion(wC, delProof);
    expect(updatedWC.epoch).toBe(delProof.newEpoch);
    expect(acc.verifyWitnessWithTrapdoor(updatedWC, delProof.newAccumulator)).toBe(true);

    const zkPostDel = acc.proveMembershipZK(updatedWC, delProof.newAccumulator, 'post-revoke');
    expect(acc.verifyMembershipZK(zkPostDel)).toBe(true);

    expect(() => acc.updateWitnessAfterDeletion({ ...wA, element: 'cred-b' }, delProof)).toThrow();

    const json = JSON.parse(acc.serializeDeletionProof(delProof)) as { deletedElements: string[] };
    expect(json.deletedElements).toEqual(['cred-b', 'cred-d']);
  });

  it('handles duplicate additions, sequential deletion epochs, and rejects tampered proofs', () => {
    expect(() => new ZeroKnowledgeAccumulatorBatchDelete(0n)).toThrow();
    const acc = new ZeroKnowledgeAccumulatorBatchDelete(987654321n);
    const add1 = acc.addBatch(['u1', 'u2', 'u3', 'u4', 'u1']);
    expect(add1.addedCount).toBe(4);
    expect(acc.addBatch(['u1', 'u2']).addedCount).toBe(0);
    expect(acc.getState().epoch).toBe(1);

    const wU4 = acc.issueWitness('u4');
    const del1 = acc.deleteBatch(['u1']);
    const wU4Ep2 = acc.updateWitnessAfterDeletion(wU4, del1);
    const del2 = acc.deleteBatch(['u2', 'u3']);
    const wU4Ep3 = acc.updateWitnessAfterDeletion(wU4Ep2, del2);
    expect(acc.verifyWitnessWithTrapdoor(wU4Ep3, del2.newAccumulator)).toBe(true);

    expect(() => acc.issueWitness('u1')).toThrow();
    expect(() => acc.deleteBatch([])).toThrow();
    expect(() => acc.deleteBatch(['missing'])).toThrow();

    const zk = acc.proveMembershipZK(wU4Ep3, del2.newAccumulator, 'ctx-strict');
    expect(acc.verifyMembershipZK({ ...zk, context: 'wrong' })).toBe(false);
    expect(acc.verifyMembershipZK({ ...zk, responseR: (zk.responseR + 1n) % SUBGROUP_Q })).toBe(false);
    expect(acc.verifyMembershipZK({ ...zk, blindedWitness: (zk.blindedWitness * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(acc.verifyBatchDeletion({ ...del2, responseProduct: (del2.responseProduct + 1n) % SUBGROUP_Q })).toBe(false);
    expect(() => acc.updateWitnessAfterDeletion(wU4Ep2, { ...del2, newEpoch: 99 })).toThrow();
  });
});
