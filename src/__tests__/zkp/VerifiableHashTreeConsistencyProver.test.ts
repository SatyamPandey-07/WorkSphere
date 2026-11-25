import { describe, it, expect } from 'vitest';
import { VerifiableHashTreeConsistencyProver } from '../../core/zkp/VerifiableHashTreeConsistencyProver';

describe('VerifiableHashTreeConsistencyProver', () => {
  it('builds 4-ary hash trees with O(log_4 N) proofs, verifies batch inclusions, and proves append consistency', () => {
    const tree = new VerifiableHashTreeConsistencyProver('state-q4-2026');
    const batch1 = Array.from({ length: 10 }, (_, i) => ({ key: `k-${i}`, value: `v-${i}` }));
    const cp1 = tree.appendEntries(batch1);
    expect(cp1.version).toBe(1);
    expect(cp1.treeSize).toBe(10);

    const batch2 = Array.from({ length: 14 }, (_, i) => ({ key: `k-${10 + i}`, value: `v-${10 + i}` }));
    const cp2 = tree.appendEntries(batch2);
    expect(cp2.version).toBe(2);
    expect(cp2.treeSize).toBe(24);
    expect(tree.getSize()).toBe(24);

    // For 24 leaves in a 4-ary tree, height is ceil(log_4(24)) = 3 (vs 5 for binary!)
    const p19 = tree.proveInclusion(19);
    expect(p19.steps.length).toBe(3);
    expect(tree.verifyInclusion(p19)).toBe(true);
    expect(tree.verifyInclusion({ ...p19, entry: { ...p19.entry, value: 'tampered' } })).toBe(false);
    expect(tree.verifyInclusion({ ...p19, leafIndex: 18 })).toBe(false);

    // Batch inclusion verification
    const allProofs = [0, 5, 9, 10, 17, 23].map((idx) => tree.proveInclusion(idx));
    expect(tree.verifyBatchInclusions(allProofs, cp2.root)).toEqual({ allValid: true, failedIndices: [] });
    expect(
      tree.verifyBatchInclusions([allProofs[0], { ...allProofs[1], root: '00'.repeat(32) }], cp2.root),
    ).toEqual({ allValid: false, failedIndices: [1] });

    // Append consistency between cp1 and cp2
    const cons = tree.proveAppendConsistency(1, 2);
    expect(tree.verifyAppendConsistency(cons, batch1)).toBe(true);

    // Mutating historical entry in old snapshot MUST break consistency!
    const forgedOld = batch1.map((e, i) => (i === 3 ? { ...e, value: 'forged' } : e));
    expect(tree.verifyAppendConsistency(cons, forgedOld)).toBe(false);
    expect(tree.verifyAppendConsistency({ ...cons, newCheckpoint: { ...cp2, root: 'ff'.repeat(32) } }, batch1)).toBe(false);

    const json = JSON.parse(tree.serializeCheckpoint(cp2)) as { version: number; treeSize: number };
    expect(json.version).toBe(2);
    expect(json.treeSize).toBe(24);
  });

  it('handles 1-leaf and 64-leaf boundary trees and rejects invalid arguments', () => {
    const t = new VerifiableHashTreeConsistencyProver('edge-q4');
    expect(t.getRootAtSize(0)).toHaveLength(64);
    expect(() => t.appendEntries([])).toThrow();
    expect(() => t.getRootAtSize(1)).toThrow();

    const cp1 = t.appendEntries([{ key: 'solo', value: 'only' }]);
    const pSolo = t.proveInclusion(0);
    expect(pSolo.steps.length).toBe(0);
    expect(t.verifyInclusion(pSolo)).toBe(true);

    const rest = Array.from({ length: 63 }, (_, i) => ({ key: `m-${i}`, value: `val-${i}` }));
    const cp2 = t.appendEntries(rest);
    expect(cp2.treeSize).toBe(64);
    // Exact 4^3 = 64 leaves -> height 3 steps for every single leaf
    for (const idx of [0, 15, 31, 47, 63]) {
      const p = t.proveInclusion(idx);
      expect(p.steps.length).toBe(3);
      expect(t.verifyInclusion(p)).toBe(true);
    }

    expect(t.getCheckpoints().length).toBe(2);
    expect(t.getRootAtSize(1)).toBe(cp1.root);
    expect(() => t.proveInclusion(-1)).toThrow();
    expect(() => t.proveInclusion(64)).toThrow();
    expect(() => t.proveAppendConsistency(2, 1)).toThrow();
  });

  it('verifies historical inclusion proofs at older checkpoints after subsequent appends', () => {
    const t = new VerifiableHashTreeConsistencyProver('hist-q4');
    const e1 = Array.from({ length: 5 }, (_, i) => ({ key: `a-${i}`, value: `v1-${i}` }));
    const e2 = Array.from({ length: 7 }, (_, i) => ({ key: `b-${i}`, value: `v2-${i}` }));
    const e3 = Array.from({ length: 9 }, (_, i) => ({ key: `c-${i}`, value: `v3-${i}` }));

    const cp1 = t.appendEntries(e1);
    const cp2 = t.appendEntries(e2);
    const cp3 = t.appendEntries(e3);

    // Inclusion in cp1 (size 5) remains verifiable even after cp3 (size 21) is sealed
    const oldProof = t.proveInclusion(4, cp1.treeSize);
    expect(oldProof.root).toBe(cp1.root);
    expect(t.verifyInclusion(oldProof)).toBe(true);

    // Consistency from cp1 -> cp3 skipping cp2
    const cons1to3 = t.proveAppendConsistency(1, 3);
    expect(cons1to3.appendedEntries.length).toBe(16);
    expect(t.verifyAppendConsistency(cons1to3, e1)).toBe(true);

    // Consistency from cp2 -> cp3
    const cons2to3 = t.proveAppendConsistency(2, 3);
    expect(t.verifyAppendConsistency(cons2to3, [...e1, ...e2])).toBe(true);
    expect(cp3.treeSize).toBe(21);
  });

  it('rejects tampered sibling hashes, mismatched child positions, and wrong snapshot sizes', () => {
    const t = new VerifiableHashTreeConsistencyProver('tamper-q4');
    const items = Array.from({ length: 16 }, (_, i) => ({ key: `k${i}`, value: `val${i}` }));
    const cp = t.appendEntries(items);
    const p = t.proveInclusion(11);
    expect(t.verifyInclusion(p)).toBe(true);

    // Tampered childPosition fails
    const badPos = p.steps.map((s, idx) => (idx === 0 ? { ...s, childPosition: ((s.childPosition + 1) % 4) as 0 | 1 | 2 | 3 } : s));
    expect(t.verifyInclusion({ ...p, steps: badPos })).toBe(false);

    // Tampered sibling hash fails
    const badSib = p.steps.map((s, idx) => (idx === 1 ? { ...s, siblings: ['aa'.repeat(32), s.siblings[1], s.siblings[2]] as [string, string, string] } : s));
    expect(t.verifyInclusion({ ...p, steps: badSib })).toBe(false);

    // Truncated steps fail
    expect(t.verifyInclusion({ ...p, steps: p.steps.slice(0, 1) })).toBe(false);
    expect(t.verifyInclusion({ ...p, treeSize: 11 })).toBe(false);

    const cp2 = t.appendEntries([{ key: 'k16', value: 'val16' }]);
    const cons = t.proveAppendConsistency(1, 2);
    expect(t.verifyAppendConsistency(cons, items.slice(0, 15))).toBe(false);
    expect(t.verifyAppendConsistency({ ...cons, oldCheckpoint: cp2 }, items)).toBe(false);
    expect(cp.version).toBe(1);
  });
});
