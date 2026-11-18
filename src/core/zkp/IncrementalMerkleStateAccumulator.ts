/**
 * @file IncrementalMerkleStateAccumulator.ts
 * @description O(log N) Incremental Append-Only Merkle State Frontier Accumulator
 * with RFC-6962-style Certificate Transparency Inclusion & Append-Only Consistency Proofs.
 * Allows WorkSphere audit logs to maintain a compact O(log N) frontier while proving:
 *   1. Exact inclusion of any historical event at leaf index i against tree size N.
 *   2. Cryptographic append-only consistency between any two historical roots (size M <= size N)
 *      proving the log was NEVER mutated, truncated, or rewritten retroactively.
 *   3. Batch inclusion auditing, checkpoint snapshots, and portable JSON serialization.
 */

import { createHash } from 'node:crypto';

export interface StateCheckpoint {
  treeSize: number;
  rootHash: string;
  frontierDepth: number;
  checkpointDigest: string;
}

export interface IncrementalInclusionProof {
  leafIndex: number;
  treeSize: number;
  leafPayload: string;
  leafHash: string;
  auditPath: string[];
  rootHash: string;
}

export interface AppendOnlyConsistencyProof {
  firstSize: number;
  secondSize: number;
  firstRoot: string;
  secondRoot: string;
  consistencyPath: string[];
  proofDigest: string;
}

function hashLeaf(payload: string): string {
  return createHash('sha256').update('\x00').update(payload).digest('hex');
}

function hashNode(leftHex: string, rightHex: string): string {
  return createHash('sha256')
    .update('\x01')
    .update(Buffer.from(leftHex, 'hex'))
    .update(Buffer.from(rightHex, 'hex'))
    .digest('hex');
}

function largestPowerOfTwoLessThan(n: number): number {
  let k = 1;
  while ((k << 1) < n) {
    k <<= 1;
  }
  return k;
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * RFC-6962 Incremental Append-Only Merkle State Accumulator.
 * Maintains an O(log N) frontier for constant-amortized appends alongside full subtree hashing
 * for historical inclusion and append-only consistency proofs.
 */
export class IncrementalMerkleStateAccumulator {
  private readonly leafPayloads: string[] = [];
  private readonly leafHashes: string[] = [];
  private readonly frontier: Array<string | null> = [];
  private readonly subtreeCache: Map<string, string> = new Map();

  public getSize(): number {
    return this.leafHashes.length;
  }

  /**
   * Computes the RFC-6962 Merkle Tree Hash MTH(D[start..end)) with memoization.
   */
  public computeSubtreeHash(start: number, end: number): string {
    const len = end - start;
    if (len <= 0) {
      return createHash('sha256').update('').digest('hex');
    }
    if (len === 1) {
      return this.leafHashes[start];
    }

    const cacheKey = `${start}:${end}`;
    const cached = this.subtreeCache.get(cacheKey);
    if (cached) return cached;

    const k = largestPowerOfTwoLessThan(len);
    const left = this.computeSubtreeHash(start, start + k);
    const right = this.computeSubtreeHash(start + k, end);
    const combined = hashNode(left, right);
    this.subtreeCache.set(cacheKey, combined);
    return combined;
  }

  /**
   * Appends a new state record in O(log N) frontier updates and returns the updated checkpoint.
   */
  public append(payload: string): StateCheckpoint {
    const lh = hashLeaf(payload);
    this.leafPayloads.push(payload);
    this.leafHashes.push(lh);

    // Update O(log N) binary frontier
    let carry = lh;
    let level = 0;
    while (true) {
      if (level >= this.frontier.length) {
        this.frontier.push(carry);
        break;
      }
      const existing = this.frontier[level];
      if (existing === null) {
        this.frontier[level] = carry;
        break;
      }
      carry = hashNode(existing, carry);
      this.frontier[level] = null;
      level++;
    }

    return this.getCheckpoint();
  }

  /**
   * Appends a batch of payloads sequentially and returns the final checkpoint.
   */
  public appendBatch(payloads: readonly string[]): StateCheckpoint {
    if (payloads.length === 0) {
      throw new Error('Cannot append an empty batch');
    }
    let cp!: StateCheckpoint;
    for (const p of payloads) {
      cp = this.append(p);
    }
    return cp;
  }

  /**
   * Computes the current root hash in O(log N) directly from the compact frontier peaks.
   */
  public getFrontierRoot(): string {
    const n = this.leafHashes.length;
    if (n === 0) {
      return createHash('sha256').update('').digest('hex');
    }

    let acc: string | null = null;
    for (let lvl = 0; lvl < this.frontier.length; lvl++) {
      const peak = this.frontier[lvl];
      if (peak === null) continue;
      acc = acc === null ? peak : hashNode(peak, acc);
    }
    return acc!;
  }

  /**
   * Returns a signed-style checkpoint summary at the current log size (or any historical size <= N).
   */
  public getCheckpoint(historicalSize = this.leafHashes.length): StateCheckpoint {
    if (!Number.isInteger(historicalSize) || historicalSize < 0 || historicalSize > this.leafHashes.length) {
      throw new RangeError('Invalid historical tree size');
    }
    const rootHash =
      historicalSize === this.leafHashes.length
        ? this.getFrontierRoot()
        : this.computeSubtreeHash(0, historicalSize);

    const checkpointDigest = createHash('sha256')
      .update(`WorkSphere::IncMerkleCP|size:${historicalSize}|root:${rootHash}`)
      .digest('hex');

    return {
      treeSize: historicalSize,
      rootHash,
      frontierDepth: this.frontier.filter((x) => x !== null).length,
      checkpointDigest,
    };
  }

  /**
   * Generates an RFC-6962 inclusion proof for leafIndex against `treeSize` (defaults to current size).
   */
  public generateInclusionProof(
    leafIndex: number,
    treeSize = this.leafHashes.length
  ): IncrementalInclusionProof {
    if (!Number.isInteger(treeSize) || treeSize < 1 || treeSize > this.leafHashes.length) {
      throw new RangeError('Invalid treeSize for inclusion proof');
    }
    if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= treeSize) {
      throw new RangeError('leafIndex out of bounds for treeSize');
    }

    const auditPath = this.buildAuditPath(leafIndex, 0, treeSize);
    const rootHash = this.computeSubtreeHash(0, treeSize);

    return {
      leafIndex,
      treeSize,
      leafPayload: this.leafPayloads[leafIndex],
      leafHash: this.leafHashes[leafIndex],
      auditPath,
      rootHash,
    };
  }

  private buildAuditPath(index: number, start: number, end: number): string[] {
    const len = end - start;
    if (len <= 1) return [];
    const k = largestPowerOfTwoLessThan(len);
    if (index < start + k) {
      const sub = this.buildAuditPath(index, start, start + k);
      sub.push(this.computeSubtreeHash(start + k, end));
      return sub;
    } else {
      const sub = this.buildAuditPath(index, start + k, end);
      sub.push(this.computeSubtreeHash(start, start + k));
      return sub;
    }
  }

  /**
   * Publicly verifies an RFC-6962 Merkle inclusion proof against an expected root hash.
   */
  public verifyInclusionProof(
    proof: IncrementalInclusionProof,
    expectedRootHash: string
  ): { valid: boolean; reason?: string } {
    if (proof.leafIndex < 0 || proof.leafIndex >= proof.treeSize || proof.treeSize < 1) {
      return { valid: false, reason: 'Invalid leaf index or tree size' };
    }

    const computedLeaf = hashLeaf(proof.leafPayload);
    if (computedLeaf !== proof.leafHash) {
      return { valid: false, reason: 'Leaf payload hash mismatch' };
    }

    let fn = proof.leafIndex;
    let sn = proof.treeSize - 1;
    let r = computedLeaf;

    for (const p of proof.auditPath) {
      if (sn === 0) {
        return { valid: false, reason: 'Excess audit path nodes' };
      }
      if ((fn & 1) === 1 || fn === sn) {
        r = hashNode(p, r);
        while ((fn & 1) === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      } else {
        r = hashNode(r, p);
      }
      fn >>= 1;
      sn >>= 1;
    }

    if (sn !== 0) {
      return { valid: false, reason: 'Incomplete audit path' };
    }
    if (r !== expectedRootHash || proof.rootHash !== expectedRootHash) {
      return { valid: false, reason: 'Reconstructed Merkle root mismatch' };
    }

    return { valid: true };
  }

  /**
   * Generates an RFC-6962 append-only consistency proof showing that the historical log of size
   * `firstSize` is an immutable prefix of the log of size `secondSize`.
   */
  public generateConsistencyProof(
    firstSize: number,
    secondSize = this.leafHashes.length
  ): AppendOnlyConsistencyProof {
    if (
      !Number.isInteger(firstSize) ||
      !Number.isInteger(secondSize) ||
      firstSize < 1 ||
      firstSize > secondSize ||
      secondSize > this.leafHashes.length
    ) {
      throw new RangeError('Consistency proof requires 1 <= firstSize <= secondSize <= currentSize');
    }

    const firstRoot = this.computeSubtreeHash(0, firstSize);
    const secondRoot = this.computeSubtreeHash(0, secondSize);
    const consistencyPath =
      firstSize === secondSize ? [] : this.subproof(firstSize, 0, secondSize, true);

    const proofDigest = createHash('sha256')
      .update(
        `WorkSphere::Consistency|${firstSize}->${secondSize}|${firstRoot}|${secondRoot}|${consistencyPath.join(',')}`
      )
      .digest('hex');

    return {
      firstSize,
      secondSize,
      firstRoot,
      secondRoot,
      consistencyPath,
      proofDigest,
    };
  }

  private subproof(m: number, start: number, end: number, isCompleteSubtree: boolean): string[] {
    const n = end - start;
    if (m === n) {
      return isCompleteSubtree ? [] : [this.computeSubtreeHash(start, end)];
    }
    const k = largestPowerOfTwoLessThan(n);
    if (m <= k) {
      const sub = this.subproof(m, start, start + k, isCompleteSubtree);
      sub.push(this.computeSubtreeHash(start + k, end));
      return sub;
    } else {
      const sub = this.subproof(m - k, start + k, end, false);
      sub.push(this.computeSubtreeHash(start, start + k));
      return sub;
    }
  }

  /**
   * Verifies an RFC-6962 append-only consistency proof using ONLY the two roots and proof path.
   */
  public verifyConsistencyProof(proof: AppendOnlyConsistencyProof): { valid: boolean; reason?: string } {
    const { firstSize: first, secondSize: second, firstRoot, secondRoot } = proof;
    if (first < 1 || second < first) {
      return { valid: false, reason: 'Invalid tree sizes for consistency proof' };
    }
    if (first === second) {
      return firstRoot === secondRoot && proof.consistencyPath.length === 0
        ? { valid: true }
        : { valid: false, reason: 'Identical size roots must match with empty path' };
    }
    if (proof.consistencyPath.length === 0) {
      return { valid: false, reason: 'Empty consistency path for growing tree' };
    }

    const path = isPowerOfTwo(first)
      ? [firstRoot, ...proof.consistencyPath]
      : [...proof.consistencyPath];

    let fn = first - 1;
    let sn = second - 1;
    while ((fn & 1) === 1) {
      fn >>= 1;
      sn >>= 1;
    }

    let fr = path[0];
    let sr = path[0];

    for (let i = 1; i < path.length; i++) {
      const c = path[i];
      if (sn === 0) {
        return { valid: false, reason: 'Excess nodes in consistency path' };
      }
      if ((fn & 1) === 1 || fn === sn) {
        fr = hashNode(c, fr);
        sr = hashNode(c, sr);
        while ((fn & 1) === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      } else {
        sr = hashNode(sr, c);
      }
      fn >>= 1;
      sn >>= 1;
    }

    if (sn !== 0) {
      return { valid: false, reason: 'Incomplete consistency path' };
    }
    if (fr !== firstRoot) {
      return { valid: false, reason: 'Historical firstRoot reconstruction mismatch' };
    }
    if (sr !== secondRoot) {
      return { valid: false, reason: 'Updated secondRoot reconstruction mismatch' };
    }

    return { valid: true };
  }

  /**
   * Batch-verifies multiple inclusion proofs against one checkpoint root.
   */
  public batchVerifyInclusions(
    proofs: readonly IncrementalInclusionProof[],
    expectedRootHash: string
  ): { allValid: boolean; validCount: number; failedLeafIndices: number[] } {
    const failedLeafIndices: number[] = [];
    for (const p of proofs) {
      if (!this.verifyInclusionProof(p, expectedRootHash).valid) {
        failedLeafIndices.push(p.leafIndex);
      }
    }
    return {
      allValid: proofs.length > 0 && failedLeafIndices.length === 0,
      validCount: proofs.length - failedLeafIndices.length,
      failedLeafIndices,
    };
  }

  public serializeConsistencyProof(proof: AppendOnlyConsistencyProof): string {
    return JSON.stringify(proof);
  }

  public deserializeConsistencyProof(payload: string): AppendOnlyConsistencyProof {
    return JSON.parse(payload) as AppendOnlyConsistencyProof;
  }
}
