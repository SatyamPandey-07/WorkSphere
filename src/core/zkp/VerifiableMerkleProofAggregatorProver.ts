/**
 * @file VerifiableMerkleProofAggregatorProver.ts
 * @description Compressed Multi-Leaf Merkle Multi-Proof (Deduplicated Co-Path) Generator & Verifier.
 * Instead of sending K separate O(log N) Merkle paths with massive overlap for K queried leaves,
 * computes the EXACT minimal set of missing co-path sibling hashes needed to reconstruct the root,
 * achieving dramatic proof-size compression with deterministic bottom-up verification!
 */

import { createHash } from 'node:crypto';

export interface MultiProofLeaf {
  index: number;
  payload: string;
  leafHash: string;
}

export interface CompressedMerkleMultiProof {
  treeId: string;
  leafCount: number;
  paddedLeafCount: number;
  treeDepth: number;
  queriedLeaves: MultiProofLeaf[];
  deduplicatedSiblingHashes: string[]; // minimal bottom-up co-path hashes in exact consumption order!
  naiveHashCount: number;
  compressedHashCount: number;
  compressionRatio: number;
  rootHash: string;
  proofDigest: string;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hashLeaf(treeId: string, index: number, payload: string): string {
  return sha256Hex(`WorkSphere::MultiMerkleLeaf|${treeId}|idx:${index}|${payload}`);
}

function hashPad(treeId: string, index: number): string {
  return sha256Hex(`WorkSphere::MultiMerklePad|${treeId}|idx:${index}`);
}

function hashPair(left: string, right: string): string {
  return createHash('sha256')
    .update('\x01')
    .update(Buffer.from(left, 'hex'))
    .update(Buffer.from(right, 'hex'))
    .digest('hex');
}

/**
 * Compressed Multi-Leaf Merkle Multi-Proof Generator & Deterministic Verifier.
 */
export class VerifiableMerkleProofAggregatorProver {
  private readonly treeId: string;
  private payloads: string[] = [];
  private paddedSize = 0;
  private levels: string[][] = [];

  constructor(treeId = 'worksphere-multiproof') {
    this.treeId = treeId;
  }

  public buildTree(payloads: readonly string[]): {
    rootHash: string;
    leafCount: number;
    paddedSize: number;
    depth: number;
  } {
    if (payloads.length === 0) throw new Error('At least one leaf payload is required');
    this.payloads = [...payloads];

    let padded = 1;
    while (padded < payloads.length) padded <<= 1;
    this.paddedSize = padded;

    const base: string[] = [];
    for (let i = 0; i < padded; i++) {
      base.push(i < payloads.length ? hashLeaf(this.treeId, i, payloads[i]) : hashPad(this.treeId, i));
    }

    this.levels = [base];
    let cur = base;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(hashPair(cur[i], cur[i + 1]));
      }
      this.levels.push(next);
      cur = next;
    }

    return {
      rootHash: this.getRootHash(),
      leafCount: payloads.length,
      paddedSize: padded,
      depth: this.levels.length - 1,
    };
  }

  public getRootHash(): string {
    if (this.levels.length === 0) throw new Error('Tree not built');
    return this.levels[this.levels.length - 1][0];
  }

  /**
   * Generates a compressed deduplicated Merkle Multi-Proof for an arbitrary subset of leaf indices!
   */
  public generateMultiProof(indices: readonly number[]): CompressedMerkleMultiProof {
    if (this.levels.length === 0) throw new Error('Tree not built');
    if (indices.length === 0) throw new Error('At least one leaf index is required');

    const sortedUnique = Array.from(new Set(indices)).sort((a, b) => a - b);
    for (const idx of sortedUnique) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= this.payloads.length) {
        throw new RangeError(`Leaf index ${idx} out of bounds`);
      }
    }

    const queriedLeaves: MultiProofLeaf[] = sortedUnique.map((index) => ({
      index,
      payload: this.payloads[index],
      leafHash: this.levels[0][index],
    }));

    const depth = this.levels.length - 1;
    const deduplicatedSiblingHashes: string[] = [];

    // Walk level-by-level from leaves (lvl=0) to root-children (lvl=depth-1)
    let activeIndices = [...sortedUnique];
    for (let lvl = 0; lvl < depth; lvl++) {
      const activeSet = new Set(activeIndices);
      const nextParentSet = new Set<number>();

      // Process pairs in ascending order so verifier consumes sibling hashes in identical order!
      for (const idx of activeIndices) {
        const siblingIdx = idx ^ 1;
        if (!activeSet.has(siblingIdx)) {
          deduplicatedSiblingHashes.push(this.levels[lvl][siblingIdx]);
        }
        nextParentSet.add(idx >> 1);
      }

      activeIndices = Array.from(nextParentSet).sort((a, b) => a - b);
    }

    const naiveHashCount = sortedUnique.length * depth;
    const compressedHashCount = deduplicatedSiblingHashes.length;
    const compressionRatio = naiveHashCount > 0 ? compressedHashCount / naiveHashCount : 1;
    const rootHash = this.getRootHash();

    const proofDigest = sha256Hex(
      `WorkSphere::MultiProof|${this.treeId}|k:${sortedUnique.length}|comp:${compressedHashCount}|${rootHash}`
    );

    return {
      treeId: this.treeId,
      leafCount: this.payloads.length,
      paddedLeafCount: this.paddedSize,
      treeDepth: depth,
      queriedLeaves,
      deduplicatedSiblingHashes,
      naiveHashCount,
      compressedHashCount,
      compressionRatio,
      rootHash,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a compressed Merkle Multi-Proof against `expectedRootHash` by reconstructing
   * ONLY the ancestor skeleton of `queriedLeaves` bottom-up using `deduplicatedSiblingHashes`!
   */
  public verifyMultiProof(
    proof: CompressedMerkleMultiProof,
    expectedRootHash: string
  ): { valid: boolean; reason?: string } {
    if (proof.treeId !== this.treeId) return { valid: false, reason: 'Tree ID mismatch' };
    if (proof.queriedLeaves.length === 0) return { valid: false, reason: 'Empty queried leaf set' };
    if (proof.rootHash !== expectedRootHash) return { valid: false, reason: 'Root hash mismatch' };

    // Verify leaves are strictly sorted & unique and hashes match payloads
    let levelMap = new Map<number, string>();
    let prevIdx = -1;
    for (const leaf of proof.queriedLeaves) {
      if (leaf.index <= prevIdx || leaf.index >= proof.leafCount) {
        return { valid: false, reason: `Invalid or unsorted leaf index ${leaf.index}` };
      }
      prevIdx = leaf.index;
      const expectedH = hashLeaf(proof.treeId, leaf.index, leaf.payload);
      if (expectedH !== leaf.leafHash) {
        return { valid: false, reason: `Leaf payload hash mismatch at index ${leaf.index}` };
      }
      levelMap.set(leaf.index, expectedH);
    }

    let sibCursor = 0;
    for (let lvl = 0; lvl < proof.treeDepth; lvl++) {
      const sortedIndices = Array.from(levelMap.keys()).sort((a, b) => a - b);
      const nextMap = new Map<number, string>();

      for (const idx of sortedIndices) {
        const parentIdx = idx >> 1;
        if (nextMap.has(parentIdx)) continue;

        const isRight = (idx & 1) === 1;
        const sibIdx = idx ^ 1;
        let sibHash = levelMap.get(sibIdx);
        if (sibHash === undefined) {
          if (sibCursor >= proof.deduplicatedSiblingHashes.length) {
            return { valid: false, reason: 'Insufficient deduplicated sibling hashes' };
          }
          sibHash = proof.deduplicatedSiblingHashes[sibCursor++];
        }

        const myHash = levelMap.get(idx)!;
        const combined = isRight ? hashPair(sibHash, myHash) : hashPair(myHash, sibHash);
        nextMap.set(parentIdx, combined);
      }

      levelMap = nextMap;
    }

    if (sibCursor !== proof.deduplicatedSiblingHashes.length) {
      return { valid: false, reason: 'Unused trailing sibling hashes in multi-proof' };
    }
    const reconstructedRoot = levelMap.get(0);
    if (reconstructedRoot !== expectedRootHash) {
      return { valid: false, reason: 'Reconstructed root hash does not match expectedRootHash' };
    }

    return { valid: true };
  }

  public serializeMultiProof(proof: CompressedMerkleMultiProof): string {
    return JSON.stringify(proof);
  }

  public deserializeMultiProof(payload: string): CompressedMerkleMultiProof {
    return JSON.parse(payload) as CompressedMerkleMultiProof;
  }
}
