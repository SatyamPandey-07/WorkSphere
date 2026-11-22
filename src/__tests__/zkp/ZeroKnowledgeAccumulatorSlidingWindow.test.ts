import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeAccumulatorSlidingWindow } from '../../core/zkp/ZeroKnowledgeAccumulatorSlidingWindow';

describe('ZeroKnowledgeAccumulatorSlidingWindow', () => {
  it('tracks TTL-bounded items, auto-evicts expired items on epoch advance, and proves non-membership', () => {
    const win = new ZeroKnowledgeAccumulatorSlidingWindow(3);
    win.insertItem('sess-alpha', 2);
    win.insertItem('sess-beta', 4);

    const mAlpha = win.proveActiveMembership('sess-alpha');
    expect(win.verifyActiveMembership(mAlpha)).toBe(true);

    // Advance 2 epochs -> sess-alpha expires, sess-beta stays active
    const adv = win.advanceEpoch(2);
    expect(adv.evictedItemIds).toEqual(['sess-alpha']);
    expect(win.verifyActiveMembership(mAlpha)).toBe(false);

    const nonMemAlpha = win.proveNonMembership('sess-alpha');
    expect(win.verifyNonMembership(nonMemAlpha)).toBe(true);
    expect(win.verifyNonMembership({ ...nonMemAlpha, commitmentD: nonMemAlpha.commitmentD + 1n })).toBe(false);

    const mBeta = win.proveActiveMembership('sess-beta');
    expect(win.verifyActiveMembership(mBeta)).toBe(true);
  });

  it('supports TTL renewal, epoch history snapshots, and proof JSON serialization', () => {
    const win = new ZeroKnowledgeAccumulatorSlidingWindow(2);
    win.insertItem('tok-keep', 2);
    win.renewItemTtl('tok-keep', 3);

    const adv = win.advanceEpoch(3);
    expect(adv.evictedItemIds).toEqual([]);
    expect(win.getEpochHistory().length).toBeGreaterThanOrEqual(2);

    const proof = win.proveActiveMembership('tok-keep');
    const json = win.serializeMembershipProof(proof);
    const restored = win.deserializeMembershipProof(json);
    expect(restored).toEqual(proof);
    expect(win.verifyActiveMembership(restored)).toBe(true);
  });
});
