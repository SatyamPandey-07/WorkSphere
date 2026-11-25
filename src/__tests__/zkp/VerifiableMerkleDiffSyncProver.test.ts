import { describe, it, expect } from 'vitest';
import { VerifiableMerkleDiffSyncProver } from '../../core/zkp/VerifiableMerkleDiffSyncProver';

describe('VerifiableMerkleDiffSyncProver', () => {
  it('computes minimal subtree-pruned diff patches and deterministically syncs replicas', () => {
    const replicaA = new VerifiableMerkleDiffSyncProver(64);
    const replicaB = new VerifiableMerkleDiffSyncProver(64);

    // Seed 50 shared records
    for (let i = 0; i < 50; i++) {
      replicaA.set(`item:${i}`, `val:${i}`);
      replicaB.set(`item:${i}`, `val:${i}`);
    }
    expect(replicaA.getRootHash()).toBe(replicaB.getRootHash());

    // Mutate only 3 keys on replicaB
    replicaB.set('item:7', 'val:7-updated');
    replicaB.delete('item:21');
    replicaB.set('item:new-99', 'val:99');
    expect(replicaA.getRootHash()).not.toBe(replicaB.getRootHash());

    const patch = replicaA.computeMinimalDiffPatch('sync-001', replicaB);
    expect(patch.changedBuckets.length).toBeLessThanOrEqual(3);
    expect(patch.nodesInspected).toBeLessThan(64); // Subtree pruning skipped identical subtrees!
    expect(replicaA.verifyDiffPatch(patch).valid).toBe(true);

    const json = replicaA.serializePatch(patch);
    const restored = replicaA.deserializePatch(json);
    const res = replicaA.applyVerifiedPatch(restored);

    expect(res.applied).toBe(true);
    expect(res.newRootHash).toBe(replicaB.getRootHash());
    expect(replicaA.get('item:7')).toBe('val:7-updated');
    expect(replicaA.get('item:21')).toBeUndefined();
    expect(replicaA.get('item:new-99')).toBe('val:99');
  });
});
