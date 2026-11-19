/**
 * @file ZeroKnowledgeMerkleMountainRangeProver.ts
 * @description Cryptographic Merkle Mountain Range (MMR) Append-Only Accumulator with
 * Right-to-Left Peak Bagging, Historical Leaf Inclusion Proofs, Multi-Leaf Batch Auditing,
 * Mountain Peak Snapshots, and Portable JSON Serialization.
 * Stores nodes in canonical 1-indexed post-order MMR layout where each append takes O(log N)
 * merges and produces a compact mountain-peak vector bagged into a single 256-bit root hash.
 */

import { createHash } from 'node:crypto';

export interface MMRPeak {
  position: number; // 1-indexed MMR node position
  height: number;
  hash: string;
}

export interface MMRSnapshot {
  leafCount: number;
  nodeCount: number;
  peaks: MMRPeak[];
  baggedRootHash: string;
  snapshotDigest: string;
}

export interface MMRInclusionProof {
  leafIndex: number; // 0-indexed leaf order
  leafPosition: number; // 1-indexed MMR node position
  leafPayload: string;
  leafHash: string;
  peakHeight: number;
  siblingPath: Array<{ direction: 'left' | 'right'; siblingHash: string }>;
  allPeaks: string[]; // left-to-right peak hashes at target size
  peakIndex: number;  // which peak contains this leaf
  mmrSize: number;
  baggedRootHash: string;
}

function hashLeaf(position: number, payload: string): string {
  return createHash('sha256')
    .update(`WorkSphere::MMRLeaf|pos:${position}|`)
    .update(payload)
    .digest('hex');
}

function hashParent(position: number, leftHex: string, rightHex: string): string {
  return createHash('sha256')
    .update(`WorkSphere::MMRNode|pos:${position}|`)
    .update(Buffer.from(leftHex, 'hex'))
    .update(Buffer.from(rightHex, 'hex'))
    .digest('hex');
}

function hashBagPeaks(rightAcc: string, leftPeak: string): string {
  return createHash('sha256')
    .update('WorkSphere::MMRBag|')
    .update(Buffer.from(leftPeak, 'hex'))
    .update(Buffer.from(rightAcc, 'hex'))
    .digest('hex');
}

/**
 * Computes the height (0 = leaf) of a 1-indexed post-order MMR node position.
 */
function posHeight(pos: number): number {
  let x = pos;
  while (!isAllOnes(x)) {
    const bitLen = x.toString(2).length;
    const msb = (1 << (bitLen - 1)) - 1;
    x -= msb;
  }
  return x.toString(2).length - 1;
}

function isAllOnes(n: number): boolean {
  return n > 0 && (n & (n + 1)) === 0;
}

/**
 * Maps 0-based leaf index -> 1-based MMR post-order position.
 */
function leafIndexToPos(leafIdx: number): number {
  let pos = 0;
  let remaining = leafIdx;
  // Number of nodes strictly before leafIdx equals 2 * leafIdx - popcount(leafIdx) + 1
  let pop = 0;
  let t = leafIdx;
  while (t > 0) {
    pop += t & 1;
    t >>= 1;
  }
  pos = 2 * remaining - pop + 1;
  return pos;
}

/**
 * Append-Only Merkle Mountain Range (MMR) Prover & Historical Verifier.
 */
export class ZeroKnowledgeMerkleMountainRangeProver {
  // 1-indexed array: nodes[1..size]
  private readonly nodes: string[] = [''];
  private readonly leafPayloads: string[] = [];

  public getLeafCount(): number {
    return this.leafPayloads.length;
  }

  public getNodeCount(): number {
    return this.nodes.length - 1;
  }

  /**
   * Appends a new leaf payload in O(log N) merges and returns the updated MMR snapshot.
   */
  public append(payload: string): MMRSnapshot {
    const leafPos = this.nodes.length;
    const lh = hashLeaf(leafPos, payload);
    this.nodes.push(lh);
    this.leafPayloads.push(payload);

    let height = 0;
    let curPos = leafPos;
    let curHash = lh;

    while (posHeight(curPos + 1) > height) {
      const leftSiblingPos = curPos - ((1 << (height + 1)) - 1);
      const parentPos = curPos + 1;
      const parentHash = hashParent(parentPos, this.nodes[leftSiblingPos], curHash);
      this.nodes.push(parentHash);
      curPos = parentPos;
      curHash = parentHash;
      height++;
    }

    return this.getSnapshot();
  }

  public appendBatch(payloads: readonly string[]): MMRSnapshot {
    if (payloads.length === 0) throw new Error('Cannot append empty batch to MMR');
    let snap!: MMRSnapshot;
    for (const p of payloads) {
      snap = this.append(p);
    }
    return snap;
  }

  /**
   * Finds all mountain peak positions (left-to-right, strictly descending height) for a given MMR node size.
   */
  public getPeaks(mmrSize = this.getNodeCount()): MMRPeak[] {
    if (mmrSize < 0 || mmrSize > this.getNodeCount()) {
      throw new RangeError('Invalid mmrSize');
    }
    if (mmrSize === 0) return [];

    const peaks: MMRPeak[] = [];
    let pos = 0;
    let remaining = mmrSize;

    while (remaining > 0) {
      // Find largest (2^(h+1) - 1) <= remaining
      let h = 0;
      while ((1 << (h + 2)) - 1 <= remaining) h++;
      const mountainSize = (1 << (h + 1)) - 1;
      pos += mountainSize;
      peaks.push({
        position: pos,
        height: h,
        hash: this.nodes[pos],
      });
      remaining -= mountainSize;
    }

    return peaks;
  }

  /**
   * Bags peak hashes right-to-left into a single 256-bit commitment root hash.
   */
  public bagPeaks(peakHashes: readonly string[]): string {
    if (peakHashes.length === 0) {
      return createHash('sha256').update('WorkSphere::MMREmpty').digest('hex');
    }
    let acc = peakHashes[peakHashes.length - 1];
    for (let i = peakHashes.length - 2; i >= 0; i--) {
      acc = hashBagPeaks(acc, peakHashes[i]);
    }
    return acc;
  }

  public getSnapshot(mmrSize = this.getNodeCount()): MMRSnapshot {
    const peaks = this.getPeaks(mmrSize);
    const baggedRootHash = this.bagPeaks(peaks.map((p) => p.hash));
    // Leaf count at mmrSize equals sum of 2^{peak.height}
    const leafCount = peaks.reduce((acc, pk) => acc + (1 << pk.height), 0);
    const snapshotDigest = createHash('sha256')
      .update(`WorkSphere::MMRSnap|leaves:${leafCount}|nodes:${mmrSize}|root:${baggedRootHash}`)
      .digest('hex');

    return {
      leafCount,
      nodeCount: mmrSize,
      peaks,
      baggedRootHash,
      snapshotDigest,
    };
  }

  /**
   * Generates a verifiable O(log N) inclusion proof for any historical `leafIndex` at `mmrSize`.
   */
  public generateInclusionProof(
    leafIndex: number,
    mmrSize = this.getNodeCount()
  ): MMRInclusionProof {
    const leafPos = leafIndexToPos(leafIndex);
    if (leafIndex < 0 || leafIndex >= this.leafPayloads.length || leafPos > mmrSize) {
      throw new RangeError(`Leaf index ${leafIndex} not present in MMR of size ${mmrSize}`);
    }

    const peaks = this.getPeaks(mmrSize);
    const siblingPath: Array<{ direction: 'left' | 'right'; siblingHash: string }> = [];

    let curPos = leafPos;
    let height = 0;

    while (true) {
      const nextHeight = posHeight(curPos + 1);
      if (nextHeight > height) {
        // curPos is a right child
        const parentPos = curPos + 1;
        if (parentPos > mmrSize) break;
        const leftSib = curPos - ((1 << (height + 1)) - 1);
        siblingPath.push({ direction: 'left', siblingHash: this.nodes[leftSib] });
        curPos = parentPos;
      } else {
        // curPos is a left child
        const rightSib = curPos + ((1 << (height + 1)) - 1);
        const parentPos = rightSib + 1;
        if (parentPos > mmrSize) break;
        siblingPath.push({ direction: 'right', siblingHash: this.nodes[rightSib] });
        curPos = parentPos;
      }
      height++;
    }

    const peakIndex = peaks.findIndex((p) => p.position === curPos);
    if (peakIndex < 0) {
      throw new Error('Failed to locate containing MMR mountain peak');
    }

    const allPeaks = peaks.map((p) => p.hash);
    const baggedRootHash = this.bagPeaks(allPeaks);

    return {
      leafIndex,
      leafPosition: leafPos,
      leafPayload: this.leafPayloads[leafIndex],
      leafHash: this.nodes[leafPos],
      peakHeight: height,
      siblingPath,
      allPeaks,
      peakIndex,
      mmrSize,
      baggedRootHash,
    };
  }

  /**
   * Publicly verifies an MMR inclusion proof against an expected bagged root hash.
   */
  public verifyInclusionProof(
    proof: MMRInclusionProof,
    expectedBaggedRoot: string
  ): { valid: boolean; reason?: string } {
    if (proof.leafPosition !== leafIndexToPos(proof.leafIndex)) {
      return { valid: false, reason: 'Leaf position does not match leaf index' };
    }
    const recomputedLeaf = hashLeaf(proof.leafPosition, proof.leafPayload);
    if (recomputedLeaf !== proof.leafHash) {
      return { valid: false, reason: 'Leaf payload hash mismatch' };
    }

    let curHash = recomputedLeaf;
    let curPos = proof.leafPosition;
    let height = 0;

    for (const step of proof.siblingPath) {
      if (step.direction === 'left') {
        const parentPos = curPos + 1;
        curHash = hashParent(parentPos, step.siblingHash, curHash);
        curPos = parentPos;
      } else {
        const parentPos = curPos + (1 << (height + 1));
        curHash = hashParent(parentPos, curHash, step.siblingHash);
        curPos = parentPos;
      }
      height++;
    }

    if (proof.peakIndex < 0 || proof.peakIndex >= proof.allPeaks.length) {
      return { valid: false, reason: 'Peak index out of bounds' };
    }
    if (proof.allPeaks[proof.peakIndex] !== curHash) {
      return { valid: false, reason: 'Reconstructed mountain peak hash mismatch' };
    }

    const recomputedRoot = this.bagPeaks(proof.allPeaks);
    if (recomputedRoot !== expectedBaggedRoot || proof.baggedRootHash !== expectedBaggedRoot) {
      return { valid: false, reason: 'Reconstructed bagged MMR root mismatch' };
    }

    return { valid: true };
  }

  /**
   * Batch-verifies multiple historical MMR inclusion proofs against one bagged root hash.
   */
  public batchVerifyProofs(
    proofs: readonly MMRInclusionProof[],
    expectedBaggedRoot: string
  ): { allValid: boolean; validCount: number; failedLeafIndices: number[] } {
    const failedLeafIndices: number[] = [];
    for (const p of proofs) {
      if (!this.verifyInclusionProof(p, expectedBaggedRoot).valid) {
        failedLeafIndices.push(p.leafIndex);
      }
    }
    return {
      allValid: proofs.length > 0 && failedLeafIndices.length === 0,
      validCount: proofs.length - failedLeafIndices.length,
      failedLeafIndices,
    };
  }

  public serializeProof(proof: MMRInclusionProof): string {
    return JSON.stringify(proof);
  }

  public deserializeProof(payload: string): MMRInclusionProof {
    return JSON.parse(payload) as MMRInclusionProof;
  }

  /**
   * Generates a mountain-peak consistency summary proving that an older MMR snapshot's
   * complete mountain peaks remain immutable prefixes inside the current MMR node array.
   */
  public verifyHistoricalPrefixPreserved(olderSnapshot: MMRSnapshot): {
    preserved: boolean;
    checkedPeaks: number;
    mismatchedPeakPositions: number[];
  } {
    const mismatchedPeakPositions: number[] = [];
    for (const pk of olderSnapshot.peaks) {
      if (pk.position < 1 || pk.position > this.getNodeCount() || this.nodes[pk.position] !== pk.hash) {
        mismatchedPeakPositions.push(pk.position);
      }
    }
    return {
      preserved: olderSnapshot.peaks.length > 0 && mismatchedPeakPositions.length === 0,
      checkedPeaks: olderSnapshot.peaks.length,
      mismatchedPeakPositions,
    };
  }

  /**
   * Computes a compact audit digest over all current mountain peaks.
   */
  public computePeaksAuditDigest(): string {
    const peaks = this.getPeaks();
    return createHash('sha256')
      .update(`WorkSphere::MMRPeaks|n:${this.getLeafCount()}|${peaks.map((p) => `${p.position}:${p.height}:${p.hash}`).join('|')}`)
      .digest('hex');
  }
}
