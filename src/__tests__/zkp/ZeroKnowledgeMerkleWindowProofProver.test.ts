import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleWindowProofProver } from '../../core/zkp/ZeroKnowledgeMerkleWindowProofProver';

describe('ZeroKnowledgeMerkleWindowProofProver', () => {
  it('proves contiguous Merkle leaf windows with boundary-only siblings and verifies sliding overlaps', () => {
    const prover = new ZeroKnowledgeMerkleWindowProofProver('tx-log-2026');
    const items = Array.from({ length: 20 }, (_, i) => `tx-record-${i}`);
    const { root, paddedSize } = prover.build(items);
    expect(paddedSize).toBe(32);

    const winA = prover.proveWindow(3, 11);
    const winB = prover.proveWindow(8, 17);
    const winSingle = prover.proveWindow(19, 19);
    const winFull = prover.proveWindow(0, 19);

    expect(prover.verifyWindowProof(winA)).toBe(true);
    expect(prover.verifyWindowProof(winB)).toBe(true);
    expect(prover.verifyWindowProof(winSingle)).toBe(true);
    expect(prover.verifyWindowProof(winFull)).toBe(true);
    expect(winA.root).toBe(root);

    // Boundary-only proof requires <= 2 * log2(paddedSize) = 10 siblings regardless of window width!
    expect(winA.leftBoundarySiblings.length + winA.rightBoundarySiblings.length).toBeLessThanOrEqual(10);

    // Overlapping sliding windows [3..11] and [8..17] match on [8..11]
    expect(prover.verifySlidingOverlap(winA, winB)).toBe(true);
    // Disjoint windows [3..11] and [19..19] return false for overlap check
    expect(prover.verifySlidingOverlap(winA, winSingle)).toBe(false);

    const json = JSON.parse(prover.serializeProof(winA)) as { windowStart: number; windowEnd: number; leafCount: number };
    expect(json.windowStart).toBe(3);
    expect(json.windowEnd).toBe(11);
    expect(json.leafCount).toBe(9);
  });

  it('verifies all odd/even boundary windows and rejects tampered leaves, siblings, and bounds', () => {
    const prover = new ZeroKnowledgeMerkleWindowProofProver('strict-win');
    expect(() => prover.build([])).toThrow();
    expect(() => prover.getRoot()).toThrow();

    prover.build(Array.from({ length: 13 }, (_, i) => `item-${i}`));
    for (const [s, e] of [[0, 0], [0, 3], [1, 2], [4, 7], [5, 12], [12, 12]]) {
      const p = prover.proveWindow(s, e);
      expect(prover.verifyWindowProof(p)).toBe(true);
    }

    const p = prover.proveWindow(2, 9);
    // Tamper middle leaf
    const badLeaves = p.windowLeaves.map((v, i) => (i === 3 ? 'forged' : v));
    expect(prover.verifyWindowProof({ ...p, windowLeaves: badLeaves })).toBe(false);
    // Drop a boundary sibling
    expect(prover.verifyWindowProof({ ...p, leftBoundarySiblings: [] })).toBe(false);
    // Wrong window index or root
    expect(prover.verifyWindowProof({ ...p, windowStart: 1, windowEnd: 8 })).toBe(false);
    expect(prover.verifyWindowProof({ ...p, root: '00'.repeat(32) })).toBe(false);
    expect(prover.verifyWindowProof({ ...p, paddedSize: 15 })).toBe(false);
    expect(() => prover.proveWindow(-1, 5)).toThrow();
    expect(() => prover.proveWindow(6, 5)).toThrow();
    expect(() => prover.proveWindow(0, 13)).toThrow();
  });

  it('works cleanly on a single-leaf degenerate tree of size 1', () => {
    const solo = new ZeroKnowledgeMerkleWindowProofProver('solo-win');
    const info = solo.build(['only-leaf']);
    expect(info.paddedSize).toBe(1);
    const p = solo.proveWindow(0, 0);
    expect(p.leftBoundarySiblings).toEqual([]);
    expect(p.rightBoundarySiblings).toEqual([]);
    expect(solo.verifyWindowProof(p)).toBe(true);
    expect(solo.verifyWindowProof({ ...p, windowLeaves: ['wrong'] })).toBe(false);
  });

  it('exhaustively verifies sliding windows across a 32-leaf power-of-2 tree with chained overlaps', () => {
    const prover = new ZeroKnowledgeMerkleWindowProofProver('stream-32');
    const leaves = Array.from({ length: 32 }, (_, i) => `event-payload-${i.toString().padStart(3, '0')}`);
    const info = prover.build(leaves);
    expect(info.treeSize).toBe(32);
    expect(info.paddedSize).toBe(32);

    // Verify 6 overlapping sliding windows of width 8 stepping by 4: [0..7], [4..11], ..., [20..27], [24..31]
    const windows = [];
    for (let start = 0; start <= 24; start += 4) {
      const w = prover.proveWindow(start, start + 7);
      expect(prover.verifyWindowProof(w)).toBe(true);
      expect(w.windowLeaves.length).toBe(8);
      windows.push(w);
    }

    for (let i = 0; i < windows.length - 1; i++) {
      expect(prover.verifySlidingOverlap(windows[i], windows[i + 1])).toBe(true);
    }

    // Power-of-2 aligned subtree window [0..7] needs 0 left siblings and only 2 right siblings!
    expect(windows[0].leftBoundarySiblings.length).toBe(0);
    expect(windows[0].rightBoundarySiblings.length).toBe(2);

    // Aligned rightmost window [24..31] needs 0 right siblings and only 2 left siblings!
    const lastWin = windows[windows.length - 1];
    expect(lastWin.rightBoundarySiblings.length).toBe(0);
    expect(lastWin.leftBoundarySiblings.length).toBe(2);
  });

  it('rejects cross-domain root reuse, mismatched window lengths, and missing right boundary siblings', () => {
    const pA = new ZeroKnowledgeMerkleWindowProofProver('domain-A');
    const pB = new ZeroKnowledgeMerkleWindowProofProver('domain-B');
    const data = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
    const rA = pA.build(data);
    const rB = pB.build(data);
    expect(rA.root).not.toBe(rB.root);

    const winA = pA.proveWindow(1, 4);
    expect(pA.verifyWindowProof(winA)).toBe(true);
    expect(pB.verifyWindowProof(winA)).toBe(false);

    // Dropping right boundary sibling fails
    expect(pA.verifyWindowProof({ ...winA, rightBoundarySiblings: [] })).toBe(false);
    // Truncating windowLeaves fails
    expect(pA.verifyWindowProof({ ...winA, windowLeaves: winA.windowLeaves.slice(0, 3) })).toBe(false);
    // Tampering with right boundary sibling hash fails
    const badRight = winA.rightBoundarySiblings.map((s, i) => (i === 0 ? { ...s, hash: 'ff'.repeat(32) } : s));
    expect(pA.verifyWindowProof({ ...winA, rightBoundarySiblings: badRight })).toBe(false);

    // Overlap check rejects two valid windows from DIFFERENT roots
    const winB = pB.proveWindow(2, 5);
    expect(pA.verifySlidingOverlap(winA, winB)).toBe(false);
  });

  it('verifies every possible [start, end] sub-window in an odd 7-leaf tree', () => {
    const prover = new ZeroKnowledgeMerkleWindowProofProver('odd-7');
    prover.build(['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
    for (let s = 0; s < 7; s++) {
      for (let e = s; e < 7; e++) {
        const proof = prover.proveWindow(s, e);
        expect(prover.verifyWindowProof(proof)).toBe(true);
      }
    }
  });

  it('verifies overlapping windows with tampered overlap data are rejected and handles 64-leaf stress trees', () => {
    const big = new ZeroKnowledgeMerkleWindowProofProver('stress-64');
    const items = Array.from({ length: 64 }, (_, i) => `row-${i}`);
    const meta = big.build(items);
    expect(meta.paddedSize).toBe(64);
    const w1 = big.proveWindow(10, 35);
    const w2 = big.proveWindow(25, 50);
    expect(big.verifyWindowProof(w1)).toBe(true);
    expect(big.verifyWindowProof(w2)).toBe(true);
    expect(big.verifySlidingOverlap(w1, w2)).toBe(true);
    expect(w1.leftBoundarySiblings.length + w1.rightBoundarySiblings.length).toBeLessThanOrEqual(12);

    // Invalid paddedSize / treeSize combinations fail cleanly
    expect(big.verifyWindowProof({ ...w1, treeSize: 0 })).toBe(false);
    expect(big.verifyWindowProof({ ...w1, paddedSize: 0 })).toBe(false);
    expect(big.verifyWindowProof({ ...w1, windowStart: -1 })).toBe(false);
    expect(big.verifyWindowProof({ ...w1, windowEnd: 64 })).toBe(false);
  });
});
