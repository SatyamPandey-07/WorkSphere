/**
 * @file VerifiableMerkleDiffSyncProver.ts
 * @description Cryptographic Fixed-Bucket Merkle State-Diff Reconciliation & Minimal Patch
 * Verifier for Distributed WorkSphere Replicas.
 * Partitions key-value state into B power-of-two deterministic buckets hashed into a binary
 * Merkle tree so two replicas can:
 *   1. Compare roots in O(1); if different, descend ONLY divergent subtrees in O(k log B) to
 *      pinpoint exact differing buckets without scanning identical state!
 *   2. Emit a minimal cryptographic SyncPatch containing ONLY the changed bucket payloads plus
 *      their Merkle authentication paths against both sourceRoot and targetRoot.
 *   3. Verify that applying the patch transforms sourceRoot -> targetRoot deterministically!
 */

import { createHash } from 'node:crypto';

export interface BucketEntry {
  key: string;
  value: string;
}

export interface BucketMerkleProof {
  bucketIndex: number;
  entries: BucketEntry[];
  bucketHash: string;
  merklePath: Array<{ direction: 'left' | 'right'; siblingHash: string }>;
}

export interface MerkleDiffSyncPatch {
  patchId: string;
  bucketCount: number;
  sourceRootHash: string;
  targetRootHash: string;
  changedBuckets: Array<{
    bucketIndex: number;
    sourceProof: BucketMerkleProof;
    targetProof: BucketMerkleProof;
    addedKeys: string[];
    modifiedKeys: string[];
    removedKeys: string[];
  }>;
  nodesInspected: number;
  patchDigest: string;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hashBucket(bucketIndex: number, entries: readonly BucketEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const h = createHash('sha256');
  h.update(`WorkSphere::DiffBucket|idx:${bucketIndex}|n:${sorted.length}`);
  for (const e of sorted) h.update(`|${e.key}=${e.value}`);
  return h.digest('hex');
}

function hashPair(leftHex: string, rightHex: string): string {
  return createHash('sha256')
    .update('\x01')
    .update(Buffer.from(leftHex, 'hex'))
    .update(Buffer.from(rightHex, 'hex'))
    .digest('hex');
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

/**
 * Bucketed Merkle State-Diff Reconciliation & Minimal Patch Verification Engine.
 */
export class VerifiableMerkleDiffSyncProver {
  private readonly bucketCount: number;
  private readonly buckets: Array<Map<string, string>>;
  private levels: string[][] = [];
  private dirty = true;

  constructor(bucketCount = 64) {
    if (!isPowerOfTwo(bucketCount)) {
      throw new RangeError('bucketCount must be a power of two >= 2');
    }
    this.bucketCount = bucketCount;
    this.buckets = Array.from({ length: bucketCount }, () => new Map<string, string>());
  }

  public getBucketCount(): number {
    return this.bucketCount;
  }

  public keyToBucket(key: string): number {
    const digest = createHash('sha256').update(`WorkSphere::BucketAssign|${key}`).digest();
    return digest.readUInt32BE(0) & (this.bucketCount - 1);
  }

  public set(key: string, value: string): void {
    const bIdx = this.keyToBucket(key);
    this.buckets[bIdx].set(key, value);
    this.dirty = true;
  }

  public delete(key: string): boolean {
    const bIdx = this.keyToBucket(key);
    const removed = this.buckets[bIdx].delete(key);
    if (removed) this.dirty = true;
    return removed;
  }

  public get(key: string): string | undefined {
    return this.buckets[this.keyToBucket(key)].get(key);
  }

  public getBucketEntries(bucketIndex: number): BucketEntry[] {
    return Array.from(this.buckets[bucketIndex].entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => ({ key, value }));
  }

  public rebuildTree(): string {
    const leaves = Array.from({ length: this.bucketCount }, (_, i) =>
      hashBucket(i, this.getBucketEntries(i))
    );
    const levels: string[][] = [leaves];
    let cur = leaves;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(hashPair(cur[i], cur[i + 1]));
      }
      levels.push(next);
      cur = next;
    }
    this.levels = levels;
    this.dirty = false;
    return levels[levels.length - 1][0];
  }

  public getRootHash(): string {
    if (this.dirty || this.levels.length === 0) return this.rebuildTree();
    return this.levels[this.levels.length - 1][0];
  }

  public getNodeHash(level: number, index: number): string {
    if (this.dirty || this.levels.length === 0) this.rebuildTree();
    return this.levels[level][index];
  }

  public proveBucket(bucketIndex: number): BucketMerkleProof {
    if (this.dirty || this.levels.length === 0) this.rebuildTree();
    const entries = this.getBucketEntries(bucketIndex);
    const merklePath: Array<{ direction: 'left' | 'right'; siblingHash: string }> = [];
    let idx = bucketIndex;
    for (let lvl = 0; lvl < this.levels.length - 1; lvl++) {
      const isRight = (idx & 1) === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      merklePath.push({
        direction: isRight ? 'left' : 'right',
        siblingHash: this.levels[lvl][sibIdx],
      });
      idx >>= 1;
    }
    return {
      bucketIndex,
      entries,
      bucketHash: this.levels[0][bucketIndex],
      merklePath,
    };
  }

  public verifyBucketProof(proof: BucketMerkleProof, expectedRootHash: string): boolean {
    if (hashBucket(proof.bucketIndex, proof.entries) !== proof.bucketHash) return false;
    let cur = proof.bucketHash;
    let reconIdx = 0;
    for (let lvl = 0; lvl < proof.merklePath.length; lvl++) {
      const step = proof.merklePath[lvl];
      if (step.direction === 'left') {
        cur = hashPair(step.siblingHash, cur);
        reconIdx |= 1 << lvl;
      } else {
        cur = hashPair(cur, step.siblingHash);
      }
    }
    return reconIdx === proof.bucketIndex && cur === expectedRootHash;
  }

  /**
   * Subtree-pruning recursive Merkle diff between `this` (source replica) and `targetReplica`:
   * skips identical subtrees in O(1) and emits a minimal verifiable SyncPatch!
   */
  public computeMinimalDiffPatch(
    patchId: string,
    targetReplica: VerifiableMerkleDiffSyncProver
  ): MerkleDiffSyncPatch {
    if (targetReplica.getBucketCount() !== this.bucketCount) {
      throw new Error('Replicas must share identical bucketCount for Merkle diff sync');
    }

    const sourceRootHash = this.getRootHash();
    const targetRootHash = targetReplica.getRootHash();
    const topLevel = this.levels.length - 1;
    const diffBucketIndices: number[] = [];
    let nodesInspected = 0;

    const walk = (level: number, index: number): void => {
      nodesInspected++;
      if (this.getNodeHash(level, index) === targetReplica.getNodeHash(level, index)) {
        return; // Entire subtree is identical -> prune!
      }
      if (level === 0) {
        diffBucketIndices.push(index);
        return;
      }
      walk(level - 1, index * 2);
      walk(level - 1, index * 2 + 1);
    };

    walk(topLevel, 0);

    const changedBuckets = diffBucketIndices.map((bucketIndex) => {
      const sourceProof = this.proveBucket(bucketIndex);
      const targetProof = targetReplica.proveBucket(bucketIndex);

      const srcMap = new Map(sourceProof.entries.map((e) => [e.key, e.value]));
      const tgtMap = new Map(targetProof.entries.map((e) => [e.key, e.value]));

      const addedKeys: string[] = [];
      const modifiedKeys: string[] = [];
      const removedKeys: string[] = [];

      for (const [k, v] of tgtMap.entries()) {
        if (!srcMap.has(k)) addedKeys.push(k);
        else if (srcMap.get(k) !== v) modifiedKeys.push(k);
      }
      for (const k of srcMap.keys()) {
        if (!tgtMap.has(k)) removedKeys.push(k);
      }

      return {
        bucketIndex,
        sourceProof,
        targetProof,
        addedKeys,
        modifiedKeys,
        removedKeys,
      };
    });

    const patchDigest = sha256Hex(
      `WorkSphere::DiffPatch|${patchId}|${sourceRootHash}->${targetRootHash}|changed:${diffBucketIndices.join(',')}`
    );

    return {
      patchId,
      bucketCount: this.bucketCount,
      sourceRootHash,
      targetRootHash,
      changedBuckets,
      nodesInspected,
      patchDigest,
    };
  }

  /**
   * Publicly verifies a MerkleDiffSyncPatch: confirms every changed bucket authenticates against
   * sourceRootHash and targetRootHash, and verifies key-bucket assignment invariants.
   */
  public verifyDiffPatch(patch: MerkleDiffSyncPatch): { valid: boolean; reason?: string } {
    if (patch.bucketCount !== this.bucketCount) {
      return { valid: false, reason: 'Bucket count mismatch' };
    }
    if (patch.sourceRootHash === patch.targetRootHash) {
      return patch.changedBuckets.length === 0
        ? { valid: true }
        : { valid: false, reason: 'Identical roots should not contain changed buckets' };
    }

    for (const cb of patch.changedBuckets) {
      if (!this.verifyBucketProof(cb.sourceProof, patch.sourceRootHash)) {
        return { valid: false, reason: `Invalid source Merkle proof for bucket ${cb.bucketIndex}` };
      }
      if (!this.verifyBucketProof(cb.targetProof, patch.targetRootHash)) {
        return { valid: false, reason: `Invalid target Merkle proof for bucket ${cb.bucketIndex}` };
      }
      for (const e of cb.targetProof.entries) {
        if (this.keyToBucket(e.key) !== cb.bucketIndex) {
          return { valid: false, reason: `Key ${e.key} does not belong to bucket ${cb.bucketIndex}` };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Applies a verified diff patch to `this` replica and confirms the resulting root equals targetRootHash!
   */
  public applyVerifiedPatch(patch: MerkleDiffSyncPatch): { applied: boolean; newRootHash: string; reason?: string } {
    if (this.getRootHash() !== patch.sourceRootHash) {
      return { applied: false, newRootHash: this.getRootHash(), reason: 'Local root does not match patch sourceRootHash' };
    }
    const check = this.verifyDiffPatch(patch);
    if (!check.valid) {
      return { applied: false, newRootHash: this.getRootHash(), reason: check.reason };
    }

    for (const cb of patch.changedBuckets) {
      const bucket = this.buckets[cb.bucketIndex];
      bucket.clear();
      for (const entry of cb.targetProof.entries) {
        bucket.set(entry.key, entry.value);
      }
    }
    this.dirty = true;
    const newRootHash = this.rebuildTree();
    if (newRootHash !== patch.targetRootHash) {
      return { applied: false, newRootHash, reason: 'Post-patch root hash does not match targetRootHash' };
    }
    return { applied: true, newRootHash };
  }

  public serializePatch(patch: MerkleDiffSyncPatch): string {
    return JSON.stringify(patch);
  }

  public deserializePatch(payload: string): MerkleDiffSyncPatch {
    return JSON.parse(payload) as MerkleDiffSyncPatch;
  }
}
