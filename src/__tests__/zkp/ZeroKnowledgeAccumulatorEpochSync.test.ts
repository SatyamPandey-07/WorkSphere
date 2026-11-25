import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeAccumulatorEpochSync, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeAccumulatorEpochSync';

describe('ZeroKnowledgeAccumulatorEpochSync', () => {
  it('catches up stale client witnesses across multiple epochs in one O(1) exponentiation and flags revocations', () => {
    const sync = new ZeroKnowledgeAccumulatorEpochSync();
    sync.advanceEpoch(['alice', 'bob', 'carol'], []); // epoch 1

    const aliceW1 = sync.issueWitness('alice');
    const bobW1 = sync.issueWitness('bob');
    expect(sync.verifyWitnessAtEpoch(aliceW1)).toBe(true);

    sync.advanceEpoch(['dave', 'eve'], ['bob']);     // epoch 2 (bob revoked)
    sync.advanceEpoch(['frank'], ['carol']);         // epoch 3
    sync.advanceEpoch(['grace'], []);                // epoch 4

    const sync1to4 = sync.buildCompressedSyncProof(1, 4);
    expect(sync.verifyCompressedSyncProof(sync1to4)).toBe(true);
    expect(sync.verifyCompressedSyncProof({ ...sync1to4, responseFactor: (sync1to4.responseFactor + 1n) % SUBGROUP_Q })).toBe(false);

    // Alice jumps directly from epoch 1 -> epoch 4 in a single modular exponentiation
    const aliceCatchup = sync.catchUpClientWitness(aliceW1, sync1to4);
    expect(aliceCatchup.revoked).toBe(false);
    expect(aliceCatchup.updatedWitness?.epoch).toBe(4);
    expect(sync.verifyWitnessAtEpoch(aliceCatchup.updatedWitness!)).toBe(true);

    // Bob was revoked in epoch 2 -> catchUp flags revocation immediately
    const bobCatchup = sync.catchUpClientWitness(bobW1, sync1to4);
    expect(bobCatchup.revoked).toBe(true);
    expect(bobCatchup.updatedWitness).toBeNull();

    // Epoch mismatch rejected cleanly
    expect(sync.catchUpClientWitness(aliceCatchup.updatedWitness!, sync1to4).updatedWitness).toBeNull();
    expect(() => sync.buildCompressedSyncProof(4, 2)).toThrow();
    expect(() => new ZeroKnowledgeAccumulatorEpochSync(0n)).toThrow();

    const json = JSON.parse(sync.serializeSyncProof(sync1to4)) as { fromEpoch: number; toEpoch: number; removedCount: number };
    expect(json.fromEpoch).toBe(1);
    expect(json.toEpoch).toBe(4);
    expect(json.removedCount).toBe(2);
  });

  it('supports sequential multi-hop witness catch-ups, empty-change epochs, and duplicate add/remove filtering', () => {
    const sync = new ZeroKnowledgeAccumulatorEpochSync(555123456n);
    const ep1 = sync.advanceEpoch(['u1', 'u2', 'u3', 'u1'], ['nonexistent']);
    expect(ep1.addedElements).toEqual(['u1', 'u2', 'u3']);
    expect(ep1.removedElements).toEqual([]);

    const w1 = sync.issueWitness('u1');
    const ep2 = sync.advanceEpoch([], []); // no-op epoch
    expect(ep2.accumulator).toBe(ep1.accumulator);

    const ep3 = sync.advanceEpoch(['u4', 'u5'], ['u2']);
    const ep4 = sync.advanceEpoch(['u6'], ['u3']);
    expect(sync.getCurrentEpoch()).toBe(4);

    // Hop 1 -> 2, then 2 -> 4
    const p12 = sync.buildCompressedSyncProof(1, 2);
    const p24 = sync.buildCompressedSyncProof(2, 4);
    expect(sync.verifyCompressedSyncProof(p12)).toBe(true);
    expect(sync.verifyCompressedSyncProof(p24)).toBe(true);

    const step1 = sync.catchUpClientWitness(w1, p12);
    expect(step1.updatedWitness?.epoch).toBe(2);
    const step2 = sync.catchUpClientWitness(step1.updatedWitness!, p24);
    expect(step2.updatedWitness?.epoch).toBe(4);
    expect(sync.verifyWitnessAtEpoch(step2.updatedWitness!)).toBe(true);

    // Direct 1 -> 4 yields identical witness to chained 1 -> 2 -> 4!
    const direct = sync.catchUpClientWitness(w1, sync.buildCompressedSyncProof(1, 4));
    expect(direct.updatedWitness?.witness).toBe(step2.updatedWitness?.witness);
    expect(sync.verifyCompressedSyncProof({ ...p24, toEpoch: 2 })).toBe(false);
    expect(() => sync.getEpochSnapshot(99)).toThrow();
    expect(() => sync.issueWitness('u2')).toThrow();
    expect(ep3.epoch).toBe(3);
    expect(ep4.epoch).toBe(4);
  });
});
