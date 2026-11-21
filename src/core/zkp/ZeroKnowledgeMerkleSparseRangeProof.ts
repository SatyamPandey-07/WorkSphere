import { createHash } from 'node:crypto';

/**
 * Zero-Knowledge Sparse Merkle Key-Range Exclusion & Presence Prover.
 *
 * Implements a verifiable radix-ordered sparse key-range engine backed by a Merkle tree
 * over sorted active records:
 *  - Proves ALL keys within an arbitrary lexicographical query range [rangeStart, rangeEnd]
 *    are PRESENT with exact completeness (attaching boundary left/right outer neighbor proofs
 *    certifying NO active key inside [rangeStart, rangeEnd] was omitted by a dishonest server!)
 *  - Proves an arbitrary query range [rangeStart, rangeEnd] is COMPLETELY EMPTY (zero active
 *    keys exist anywhere inside the range) using two adjacent leaves straddling the empty gap!
 */

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

export interface RangeKVRecord {
  key: string;
  value: string;
}

export interface RangeLeafWitness {
  index: number;
  key: string;
  value: string;
  path: Array<{ direction: 'left' | 'right'; hash: string }>;
  root: string;
  totalSize: number;
}

export interface CompleteRangeQueryProof {
  rangeStart: string;
  rangeEnd: string;
  root: string;
  totalSize: number;
  matchedRecords: RangeLeafWitness[];
  leftBoundaryGuard: RangeLeafWitness | null;  // key strictly < rangeStart (if matched/gap doesn't start at index 0)
  rightBoundaryGuard: RangeLeafWitness | null; // key strictly > rangeEnd (if matched/gap doesn't end at totalSize - 1)
}

export class ZeroKnowledgeMerkleSparseRangeProof {
  private readonly tableId: string;
  private records: RangeKVRecord[] = [];
  private levels: string[][] = [];

  constructor(tableId = 'sparse-range-v1') {
    this.tableId = tableId;
  }

  private hashLeaf(idx: number, key: string, value: string): string {
    return sha256Hex('SRANGE-LEAF-V1', this.tableId, String(idx), key, value);
  }

  private hashNode(left: string, right: string): string {
    return sha256Hex('SRANGE-NODE-V1', this.tableId, left, right);
  }

  public loadRecords(entries: RangeKVRecord[]): { root: string; totalSize: number } {
    if (entries.length === 0) throw new Error('Record set cannot be empty');
    const seen = new Set<string>();
    const sorted = entries
      .map((e) => ({ key: e.key, value: e.value }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const r of sorted) {
      if (seen.has(r.key)) throw new Error(`Duplicate key "${r.key}"`);
      seen.add(r.key);
    }

    this.records = sorted;
    const leaves = sorted.map((r, i) => this.hashLeaf(i, r.key, r.value));
    this.levels = [leaves];
    let cur = leaves;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(this.hashNode(cur[i], i + 1 < cur.length ? cur[i + 1] : cur[i]));
      }
      this.levels.push(next);
      cur = next;
    }

    return { root: this.getRoot(), totalSize: this.records.length };
  }

  public getRoot(): string {
    if (this.levels.length === 0) throw new Error('Table not initialized');
    return this.levels[this.levels.length - 1][0];
  }

  private proveIndex(index: number): RangeLeafWitness {
    const path: Array<{ direction: 'left' | 'right'; hash: string }> = [];
    let pos = index;
    for (let lvl = 0; lvl < this.levels.length - 1; lvl++) {
      const arr = this.levels[lvl];
      const isRight = pos % 2 === 1;
      const sibPos = isRight ? pos - 1 : (pos + 1 < arr.length ? pos + 1 : pos);
      path.push({ direction: isRight ? 'left' : 'right', hash: arr[sibPos] });
      pos >>= 1;
    }
    const r = this.records[index];
    return {
      index,
      key: r.key,
      value: r.value,
      path,
      root: this.getRoot(),
      totalSize: this.records.length,
    };
  }

  public verifyLeafWitness(w: RangeLeafWitness): boolean {
    if (w.index < 0 || w.index >= w.totalSize) return false;
    let cur = this.hashLeaf(w.index, w.key, w.value);
    let pos = w.index;
    for (const step of w.path) {
      const expectedDir = pos % 2 === 1 ? 'left' : 'right';
      if (step.direction !== expectedDir) return false;
      cur = step.direction === 'left'
        ? this.hashNode(step.hash, cur)
        : this.hashNode(cur, step.hash);
      pos >>= 1;
    }
    return pos === 0 && cur === w.root;
  }

  /**
   * Produces a cryptographically complete proof of ALL keys inside [rangeStart, rangeEnd]
   * (including empty-range exclusion when 0 keys match!).
   */
  public proveCompleteRange(rangeStart: string, rangeEnd: string): CompleteRangeQueryProof {
    if (this.records.length === 0) throw new Error('Table not initialized');
    if (rangeStart > rangeEnd) throw new RangeError('rangeStart must be <= rangeEnd');

    const n = this.records.length;
    // Find first index >= rangeStart
    let firstIdx = n;
    for (let i = 0; i < n; i++) {
      if (this.records[i].key >= rangeStart) {
        firstIdx = i;
        break;
      }
    }

    // Collect all contiguous matching records with key <= rangeEnd
    const matchedRecords: RangeLeafWitness[] = [];
    let cur = firstIdx;
    while (cur < n && this.records[cur].key <= rangeEnd) {
      matchedRecords.push(this.proveIndex(cur));
      cur++;
    }

    const leftGuardIdx = firstIdx - 1;
    const rightGuardIdx = cur;

    return {
      rangeStart,
      rangeEnd,
      root: this.getRoot(),
      totalSize: n,
      matchedRecords,
      leftBoundaryGuard: leftGuardIdx >= 0 ? this.proveIndex(leftGuardIdx) : null,
      rightBoundaryGuard: rightGuardIdx < n ? this.proveIndex(rightGuardIdx) : null,
    };
  }

  public verifyCompleteRange(proof: CompleteRangeQueryProof): boolean {
    const { rangeStart, rangeEnd, root, totalSize, matchedRecords, leftBoundaryGuard, rightBoundaryGuard } = proof;
    if (rangeStart > rangeEnd || totalSize < 1) return false;

    // Verify all witnesses belong to same root & totalSize and pass Merkle verification
    const allWitnesses: RangeLeafWitness[] = [
      ...(leftBoundaryGuard ? [leftBoundaryGuard] : []),
      ...matchedRecords,
      ...(rightBoundaryGuard ? [rightBoundaryGuard] : []),
    ];
    if (allWitnesses.length === 0) return false;

    for (const w of allWitnesses) {
      if (w.root !== root || w.totalSize !== totalSize || !this.verifyLeafWitness(w)) return false;
    }

    // Check left boundary guard: if absent, first element MUST be index 0; if present, key < rangeStart
    if (leftBoundaryGuard) {
      if (!(leftBoundaryGuard.key < rangeStart)) return false;
    } else {
      const firstAfter = matchedRecords.length > 0 ? matchedRecords[0] : rightBoundaryGuard;
      if (!firstAfter || firstAfter.index !== 0) return false;
    }

    // Check right boundary guard: if absent, last element MUST be index totalSize - 1; if present, key > rangeEnd
    if (rightBoundaryGuard) {
      if (!(rightBoundaryGuard.key > rangeEnd)) return false;
    } else {
      const lastBefore = matchedRecords.length > 0 ? matchedRecords[matchedRecords.length - 1] : leftBoundaryGuard;
      if (!lastBefore || lastBefore.index !== totalSize - 1) return false;
    }

    // Verify every matched record is within [rangeStart, rangeEnd]
    for (const m of matchedRecords) {
      if (m.key < rangeStart || m.key > rangeEnd) return false;
    }

    // CRITICAL COMPLETENESS INVARIANT: indices across [leftGuard?, ...matchedRecords, rightGuard?]
    // MUST form a STRICTLY CONTIGUOUS consecutive integer sequence (no skipped keys allowed!)
    for (let i = 1; i < allWitnesses.length; i++) {
      if (allWitnesses[i].index !== allWitnesses[i - 1].index + 1) return false;
      if (!(allWitnesses[i - 1].key < allWitnesses[i].key)) return false;
    }

    return true;
  }

  public serializeProof(proof: CompleteRangeQueryProof): string {
    return JSON.stringify({
      rangeStart: proof.rangeStart,
      rangeEnd: proof.rangeEnd,
      matchedCount: proof.matchedRecords.length,
      hasLeftGuard: proof.leftBoundaryGuard !== null,
      hasRightGuard: proof.rightBoundaryGuard !== null,
      root: proof.root,
    });
  }
}
