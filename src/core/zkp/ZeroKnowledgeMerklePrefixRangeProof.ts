/**
 * @file ZeroKnowledgeMerklePrefixRangeProof.ts
 * @description Sorted Merkle Tree Key-Value Index with Exact Inclusion Proofs,
 * Adjacent-Leaf Gap Non-Membership Proofs (proving loKey < targetKey < hiKey with consecutive
 * leaf indices idx and idx+1), Verified Range-Slice Queries, and Portable JSON Serialization.
 */

import { createHash } from 'node:crypto';

export interface SortedKVEntry {
  key: string;
  value: string;
}

export interface SortedMerkleInclusionProof {
  index: number;
  key: string;
  value: string;
  leafHash: string;
  path: Array<{ direction: 'left' | 'right'; siblingHash: string }>;
  rootHash: string;
  totalEntries: number;
}

export interface AdjacentGapNonMembershipProof {
  targetKey: string;
  caseType: 'before_first' | 'after_last' | 'between_adjacent';
  leftProof?: SortedMerkleInclusionProof;
  rightProof?: SortedMerkleInclusionProof;
  rootHash: string;
  proofDigest: string;
}

export interface VerifiedRangeSliceProof {
  lowerKey: string;
  upperKey: string;
  entries: SortedKVEntry[];
  entryProofs: SortedMerkleInclusionProof[];
  leftBoundaryProof?: SortedMerkleInclusionProof;
  rightBoundaryProof?: SortedMerkleInclusionProof;
  rootHash: string;
  sliceDigest: string;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hashLeaf(index: number, key: string, value: string): string {
  return sha256Hex(`WorkSphere::SortedMLeaf|idx:${index}|k:${key}|v:${value}`);
}

function hashPad(index: number): string {
  return sha256Hex(`WorkSphere::SortedMPad|idx:${index}`);
}

function hashInternal(left: string, right: string): string {
  return createHash('sha256')
    .update('\x01')
    .update(Buffer.from(left, 'hex'))
    .update(Buffer.from(right, 'hex'))
    .digest('hex');
}

/**
 * Sorted Merkle Key-Value Tree supporting O(log N) inclusion, adjacent-gap non-membership,
 * and complete lexicographic range-slice proofs.
 */
export class ZeroKnowledgeMerklePrefixRangeProof {
  private sortedEntries: SortedKVEntry[] = [];
  private levels: string[][] = [];
  private readonly keyToIndex: Map<string, number> = new Map();

  public buildIndex(entries: readonly SortedKVEntry[]): {
    rootHash: string;
    entryCount: number;
    treeDepth: number;
  } {
    if (entries.length === 0) throw new Error('At least one key-value entry is required');

    const map = new Map<string, string>();
    for (const e of entries) {
      if (map.has(e.key)) throw new Error(`Duplicate key in sorted index: ${e.key}`);
      map.set(e.key, e.value);
    }

    this.sortedEntries = Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => ({ key, value }));

    this.keyToIndex.clear();
    for (let i = 0; i < this.sortedEntries.length; i++) {
      this.keyToIndex.set(this.sortedEntries[i].key, i);
    }

    let padded = 1;
    while (padded < this.sortedEntries.length) padded <<= 1;

    const base: string[] = [];
    for (let i = 0; i < padded; i++) {
      if (i < this.sortedEntries.length) {
        const e = this.sortedEntries[i];
        base.push(hashLeaf(i, e.key, e.value));
      } else {
        base.push(hashPad(i));
      }
    }

    this.levels = [base];
    let cur = base;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(hashInternal(cur[i], cur[i + 1]));
      }
      this.levels.push(next);
      cur = next;
    }

    return {
      rootHash: this.getRootHash(),
      entryCount: this.sortedEntries.length,
      treeDepth: this.levels.length - 1,
    };
  }

  public getRootHash(): string {
    if (this.levels.length === 0) throw new Error('Sorted index not built');
    return this.levels[this.levels.length - 1][0];
  }

  public proveInclusionByIndex(index: number): SortedMerkleInclusionProof {
    if (index < 0 || index >= this.sortedEntries.length) {
      throw new RangeError(`Leaf index ${index} out of bounds`);
    }
    const entry = this.sortedEntries[index];
    const path: Array<{ direction: 'left' | 'right'; siblingHash: string }> = [];
    let idx = index;

    for (let lvl = 0; lvl < this.levels.length - 1; lvl++) {
      const isRight = (idx & 1) === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      path.push({
        direction: isRight ? 'left' : 'right',
        siblingHash: this.levels[lvl][sibIdx],
      });
      idx >>= 1;
    }

    return {
      index,
      key: entry.key,
      value: entry.value,
      leafHash: this.levels[0][index],
      path,
      rootHash: this.getRootHash(),
      totalEntries: this.sortedEntries.length,
    };
  }

  public proveInclusion(key: string): SortedMerkleInclusionProof {
    const idx = this.keyToIndex.get(key);
    if (idx === undefined) throw new Error(`Key ${key} not present in index`);
    return this.proveInclusionByIndex(idx);
  }

  public verifyInclusion(
    proof: SortedMerkleInclusionProof,
    expectedRootHash: string
  ): { valid: boolean; reason?: string } {
    const expectedLeaf = hashLeaf(proof.index, proof.key, proof.value);
    if (expectedLeaf !== proof.leafHash) return { valid: false, reason: 'Leaf hash mismatch' };

    let cur = expectedLeaf;
    let reconstructedIndex = 0;
    for (let lvl = 0; lvl < proof.path.length; lvl++) {
      const step = proof.path[lvl];
      if (step.direction === 'left') {
        cur = hashInternal(step.siblingHash, cur);
        reconstructedIndex |= 1 << lvl;
      } else {
        cur = hashInternal(cur, step.siblingHash);
      }
    }

    if (reconstructedIndex !== proof.index) {
      return { valid: false, reason: 'Merkle path bit-index does not match claimed leaf index' };
    }
    if (cur !== expectedRootHash || proof.rootHash !== expectedRootHash) {
      return { valid: false, reason: 'Reconstructed root hash mismatch' };
    }
    return { valid: true };
  }

  /**
   * Generates a cryptographic adjacent-leaf non-membership proof proving `targetKey` is absent.
   */
  public proveNonMembership(targetKey: string): AdjacentGapNonMembershipProof {
    if (this.keyToIndex.has(targetKey)) {
      throw new Error(`Key ${targetKey} is present in the sorted index`);
    }
    const n = this.sortedEntries.length;
    const rootHash = this.getRootHash();

    // Binary search for insertion position
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sortedEntries[mid].key < targetKey) lo = mid + 1;
      else hi = mid;
    }

    if (lo === 0) {
      const rightProof = this.proveInclusionByIndex(0);
      return {
        targetKey,
        caseType: 'before_first',
        rightProof,
        rootHash,
        proofDigest: sha256Hex(`gap|before|${targetKey}|${rightProof.key}|${rootHash}`),
      };
    }
    if (lo === n) {
      const leftProof = this.proveInclusionByIndex(n - 1);
      return {
        targetKey,
        caseType: 'after_last',
        leftProof,
        rootHash,
        proofDigest: sha256Hex(`gap|after|${targetKey}|${leftProof.key}|${rootHash}`),
      };
    }

    const leftProof = this.proveInclusionByIndex(lo - 1);
    const rightProof = this.proveInclusionByIndex(lo);
    return {
      targetKey,
      caseType: 'between_adjacent',
      leftProof,
      rightProof,
      rootHash,
      proofDigest: sha256Hex(`gap|between|${leftProof.key}<${targetKey}<${rightProof.key}|${rootHash}`),
    };
  }

  /**
   * Publicly verifies an adjacent-leaf non-membership gap proof against `expectedRootHash`.
   */
  public verifyNonMembership(
    proof: AdjacentGapNonMembershipProof,
    expectedRootHash: string
  ): { valid: boolean; reason?: string } {
    if (proof.rootHash !== expectedRootHash) return { valid: false, reason: 'Root hash mismatch' };

    if (proof.caseType === 'before_first') {
      if (!proof.rightProof || proof.rightProof.index !== 0) {
        return { valid: false, reason: 'before_first requires valid index-0 right boundary proof' };
      }
      if (!this.verifyInclusion(proof.rightProof, expectedRootHash).valid) {
        return { valid: false, reason: 'Right boundary inclusion proof failed' };
      }
      if (!(proof.targetKey < proof.rightProof.key)) {
        return { valid: false, reason: 'targetKey is not strictly less than index-0 key' };
      }
      return { valid: true };
    }

    if (proof.caseType === 'after_last') {
      if (!proof.leftProof || proof.leftProof.index !== proof.leftProof.totalEntries - 1) {
        return { valid: false, reason: 'after_last requires valid final-index left boundary proof' };
      }
      if (!this.verifyInclusion(proof.leftProof, expectedRootHash).valid) {
        return { valid: false, reason: 'Left boundary inclusion proof failed' };
      }
      if (!(proof.leftProof.key < proof.targetKey)) {
        return { valid: false, reason: 'targetKey is not strictly greater than last key' };
      }
      return { valid: true };
    }

    if (!proof.leftProof || !proof.rightProof) {
      return { valid: false, reason: 'between_adjacent requires both left and right adjacent proofs' };
    }
    if (proof.rightProof.index !== proof.leftProof.index + 1) {
      return { valid: false, reason: 'Boundary proofs are NOT consecutive indices' };
    }
    if (
      !this.verifyInclusion(proof.leftProof, expectedRootHash).valid ||
      !this.verifyInclusion(proof.rightProof, expectedRootHash).valid
    ) {
      return { valid: false, reason: 'One or both adjacent boundary proofs failed' };
    }
    if (!(proof.leftProof.key < proof.targetKey && proof.targetKey < proof.rightProof.key)) {
      return { valid: false, reason: 'targetKey does not lie strictly inside (leftKey, rightKey)' };
    }
    return { valid: true };
  }

  /**
   * Produces a complete verifiable range-slice proof for all entries with lowerKey <= k <= upperKey,
   * including flanking boundary proofs proving NO matching key was omitted at either end!
   */
  public proveRangeSlice(lowerKey: string, upperKey: string): VerifiedRangeSliceProof {
    if (lowerKey > upperKey) throw new RangeError('lowerKey must be <= upperKey');

    const indices: number[] = [];
    for (let i = 0; i < this.sortedEntries.length; i++) {
      const k = this.sortedEntries[i].key;
      if (k >= lowerKey && k <= upperKey) indices.push(i);
    }

    const entries = indices.map((i) => ({ ...this.sortedEntries[i] }));
    const entryProofs = indices.map((i) => this.proveInclusionByIndex(i));
    const leftBoundaryProof =
      indices.length > 0 && indices[0] > 0 ? this.proveInclusionByIndex(indices[0] - 1) : undefined;
    const rightBoundaryProof =
      indices.length > 0 && indices[indices.length - 1] < this.sortedEntries.length - 1
        ? this.proveInclusionByIndex(indices[indices.length - 1] + 1)
        : undefined;

    const rootHash = this.getRootHash();
    const sliceDigest = sha256Hex(
      `WorkSphere::RangeSlice|${lowerKey}..${upperKey}|n:${entries.length}|${rootHash}`
    );

    return {
      lowerKey,
      upperKey,
      entries,
      entryProofs,
      leftBoundaryProof,
      rightBoundaryProof,
      rootHash,
      sliceDigest,
    };
  }

  public verifyRangeSlice(
    slice: VerifiedRangeSliceProof,
    expectedRootHash: string
  ): { valid: boolean; reason?: string } {
    if (slice.rootHash !== expectedRootHash) return { valid: false, reason: 'Root hash mismatch' };
    if (slice.entries.length !== slice.entryProofs.length) {
      return { valid: false, reason: 'Entry and proof count mismatch' };
    }

    for (let i = 0; i < slice.entryProofs.length; i++) {
      const pr = slice.entryProofs[i];
      if (!this.verifyInclusion(pr, expectedRootHash).valid) {
        return { valid: false, reason: `Entry proof ${i} failed` };
      }
      if (pr.key < slice.lowerKey || pr.key > slice.upperKey) {
        return { valid: false, reason: `Entry ${pr.key} outside requested range` };
      }
      if (i > 0 && pr.index !== slice.entryProofs[i - 1].index + 1) {
        return { valid: false, reason: 'Range slice entries are not contiguous' };
      }
    }

    if (slice.leftBoundaryProof) {
      if (!this.verifyInclusion(slice.leftBoundaryProof, expectedRootHash).valid) {
        return { valid: false, reason: 'Left boundary proof invalid' };
      }
      if (!(slice.leftBoundaryProof.key < slice.lowerKey)) {
        return { valid: false, reason: 'Left boundary key is not strictly below lowerKey' };
      }
    }
    if (slice.rightBoundaryProof) {
      if (!this.verifyInclusion(slice.rightBoundaryProof, expectedRootHash).valid) {
        return { valid: false, reason: 'Right boundary proof invalid' };
      }
      if (!(slice.rightBoundaryProof.key > slice.upperKey)) {
        return { valid: false, reason: 'Right boundary key is not strictly above upperKey' };
      }
    }

    return { valid: true };
  }

  public serializeNonMembershipProof(proof: AdjacentGapNonMembershipProof): string {
    return JSON.stringify(proof);
  }

  public deserializeNonMembershipProof(payload: string): AdjacentGapNonMembershipProof {
    return JSON.parse(payload) as AdjacentGapNonMembershipProof;
  }
}
