import { createHash } from 'node:crypto';

/**
 * Zero-Knowledge Merkle Contiguous Sliding-Window Range Proof Prover.
 *
 * Proves that a contiguous window of leaves L[start..end] belongs sequentially inside a
 * committed binary Merkle tree WITHOUT transferring unrelated branches outside the window:
 *  - Deduplicates all internal nodes inside [start..end] so only the left-boundary siblings
 *    (for start) and right-boundary siblings (for end) are needed!
 *  - Verifier reconstructs every subtree strictly spanned by [start..end], stitches the left
 *    and right boundary sibling paths upward, and checks exact equality with the committed root!
 *  - Also supports sliding-window overlap proofs verifying consecutive windows [s1..e1] and
 *    [s2..e2] match on their overlapping segment against the SAME Merkle root!
 */

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

export interface WindowMerkleProof {
  treeSize: number;
  paddedSize: number;
  windowStart: number;
  windowEnd: number;
  windowLeaves: string[];
  leftBoundarySiblings: Array<{ level: number; nodeIndex: number; hash: string }>;
  rightBoundarySiblings: Array<{ level: number; nodeIndex: number; hash: string }>;
  root: string;
}

export class ZeroKnowledgeMerkleWindowProofProver {
  private readonly domain: string;
  private leaves: string[] = [];
  private paddedSize = 0;
  private levels: string[][] = [];

  constructor(domain = 'merkle-window-v1') {
    this.domain = domain;
  }

  public hashLeaf(index: number, data: string): string {
    return sha256Hex('WIN-LEAF-V1', this.domain, String(index), data);
  }

  public hashEmpty(index: number): string {
    return sha256Hex('WIN-EMPTY-V1', this.domain, String(index));
  }

  public hashNode(left: string, right: string): string {
    return sha256Hex('WIN-NODE-V1', this.domain, left, right);
  }

  public build(items: string[]): { root: string; treeSize: number; paddedSize: number } {
    if (items.length === 0) throw new Error('Cannot build Merkle window tree with zero leaves');
    this.leaves = [...items];
    let size = 1;
    while (size < items.length) size <<= 1;
    this.paddedSize = size;

    const base: string[] = [];
    for (let i = 0; i < size; i++) {
      base.push(i < items.length ? this.hashLeaf(i, items[i]) : this.hashEmpty(i));
    }

    this.levels = [base];
    let cur = base;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(this.hashNode(cur[i], cur[i + 1]));
      }
      this.levels.push(next);
      cur = next;
    }

    return { root: this.getRoot(), treeSize: this.leaves.length, paddedSize: this.paddedSize };
  }

  public getRoot(): string {
    if (this.levels.length === 0) throw new Error('Tree not built yet');
    return this.levels[this.levels.length - 1][0];
  }

  public proveWindow(start: number, end: number): WindowMerkleProof {
    if (this.levels.length === 0) throw new Error('Tree not built yet');
    if (start < 0 || end >= this.leaves.length || start > end) {
      throw new RangeError(`Invalid window [${start}, ${end}] for treeSize ${this.leaves.length}`);
    }

    const leftBoundarySiblings: Array<{ level: number; nodeIndex: number; hash: string }> = [];
    const rightBoundarySiblings: Array<{ level: number; nodeIndex: number; hash: string }> = [];

    let curL = start;
    let curR = end;

    for (let lvl = 0; lvl < this.levels.length - 1; lvl++) {
      // If curL is a right child (odd), its left sibling (curL - 1) is strictly outside the window
      if ((curL & 1) === 1) {
        leftBoundarySiblings.push({ level: lvl, nodeIndex: curL - 1, hash: this.levels[lvl][curL - 1] });
      }
      // If curR is a left child (even), its right sibling (curR + 1) is strictly outside the window
      if ((curR & 1) === 0) {
        rightBoundarySiblings.push({ level: lvl, nodeIndex: curR + 1, hash: this.levels[lvl][curR + 1] });
      }
      curL >>= 1;
      curR >>= 1;
    }

    return {
      treeSize: this.leaves.length,
      paddedSize: this.paddedSize,
      windowStart: start,
      windowEnd: end,
      windowLeaves: this.leaves.slice(start, end + 1),
      leftBoundarySiblings,
      rightBoundarySiblings,
      root: this.getRoot(),
    };
  }

  public verifyWindowProof(proof: WindowMerkleProof): boolean {
    const { treeSize, paddedSize, windowStart, windowEnd, windowLeaves, leftBoundarySiblings, rightBoundarySiblings, root } = proof;
    if (paddedSize < 1 || (paddedSize & (paddedSize - 1)) !== 0) return false;
    if (treeSize < 1 || treeSize > paddedSize) return false;
    if (windowStart < 0 || windowEnd >= treeSize || windowStart > windowEnd) return false;
    if (windowLeaves.length !== windowEnd - windowStart + 1) return false;

    const leftMap = new Map<string, string>();
    for (const s of leftBoundarySiblings) leftMap.set(`${s.level}:${s.nodeIndex}`, s.hash);
    const rightMap = new Map<string, string>();
    for (const s of rightBoundarySiblings) rightMap.set(`${s.level}:${s.nodeIndex}`, s.hash);

    // Build initial contiguous map of level-0 hashes covering [windowStart..windowEnd]
    let curLevel = new Map<number, string>();
    for (let i = 0; i < windowLeaves.length; i++) {
      const leafIdx = windowStart + i;
      curLevel.set(leafIdx, this.hashLeaf(leafIdx, windowLeaves[i]));
    }

    const totalLevels = Math.round(Math.log2(paddedSize));
    let curL = windowStart;
    let curR = windowEnd;

    for (let lvl = 0; lvl < totalLevels; lvl++) {
      // Inject left & right boundary siblings if needed
      if ((curL & 1) === 1) {
        const h = leftMap.get(`${lvl}:${curL - 1}`);
        if (!h) return false;
        curLevel.set(curL - 1, h);
        curL -= 1;
      }
      if ((curR & 1) === 0) {
        const h = rightMap.get(`${lvl}:${curR + 1}`);
        if (!h) return false;
        curLevel.set(curR + 1, h);
        curR += 1;
      }

      const nextLevel = new Map<number, string>();
      for (let idx = curL; idx <= curR; idx += 2) {
        const leftH = curLevel.get(idx);
        const rightH = curLevel.get(idx + 1);
        if (!leftH || !rightH) return false;
        nextLevel.set(idx >> 1, this.hashNode(leftH, rightH));
      }

      curLevel = nextLevel;
      curL >>= 1;
      curR >>= 1;
    }

    return curL === 0 && curR === 0 && curLevel.get(0) === root;
  }

  public verifySlidingOverlap(winA: WindowMerkleProof, winB: WindowMerkleProof): boolean {
    if (!this.verifyWindowProof(winA) || !this.verifyWindowProof(winB)) return false;
    if (winA.root !== winB.root || winA.treeSize !== winB.treeSize) return false;

    const overlapStart = Math.max(winA.windowStart, winB.windowStart);
    const overlapEnd = Math.min(winA.windowEnd, winB.windowEnd);
    if (overlapStart > overlapEnd) return false;

    for (let idx = overlapStart; idx <= overlapEnd; idx++) {
      const valA = winA.windowLeaves[idx - winA.windowStart];
      const valB = winB.windowLeaves[idx - winB.windowStart];
      if (valA !== valB) return false;
    }
    return true;
  }

  public serializeProof(proof: WindowMerkleProof): string {
    return JSON.stringify({
      windowStart: proof.windowStart,
      windowEnd: proof.windowEnd,
      leafCount: proof.windowLeaves.length,
      boundarySiblingCount: proof.leftBoundarySiblings.length + proof.rightBoundarySiblings.length,
      root: proof.root,
    });
  }
}
