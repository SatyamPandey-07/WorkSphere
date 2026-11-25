/**
 * @file SuccinctMerkleMultiProof.ts
 * @description Succinct Deduplicated Merkle Multi-Proof Accumulator.
 * Generates and verifies minimal-bandwidth Merkle multi-proofs for arbitrary subsets of leaves.
 * Eliminates redundant shared ancestor sibling hashes compared to O(k log N) naive individual
 * proofs using level-by-level index deduplication and domain-separated SHA-256 hashing.
 */

import { createHash } from 'crypto';

/**
 * Leaf entry submitted for multi-proof verification.
 */
export interface MultiProofLeaf {
  index: number;
  value: string;
}

/**
 * Compact deduplicated Merkle multi-proof payload.
 */
export interface MerkleMultiProof {
  leafIndices: number[];
  proofHashes: string[];
  proofFlags: boolean[];
  treeDepth: number;
  leafCount: number;
}

/**
 * Multi-proof verification result.
 */
export interface MultiProofVerificationResult {
  isValid: boolean;
  reason?: string;
  computedRoot: string;
  verifiedLeafCount: number;
}

/**
 * Compression benchmark summary comparing multi-proof vs naive proofs.
 */
export interface MultiProofCompressionStats {
  subsetSize: number;
  naiveHashCount: number;
  multiProofHashCount: number;
  hashesSaved: number;
  compressionRatio: number;
}

/**
 * Succinct Merkle Multi-Proof Tree & Verifier.
 */
export class SuccinctMerkleMultiProof {
  private levels: string[][] = [];
  private originalLeafCount: number = 0;
  private paddedSize: number = 0;
  private depth: number = 0;
  private rawLeaves: string[] = [];

  constructor(leaves?: string[]) {
    if (leaves && leaves.length > 0) {
      this.buildTree(leaves);
    }
  }

  /**
   * Domain-separated leaf hash (prefix 0x00) to prevent second-preimage attacks.
   */
  public static hashLeaf(value: string): string {
    return createHash('sha256').update('\x00' + value).digest('hex');
  }

  /**
   * Domain-separated internal node hash (prefix 0x01).
   */
  public static hashPair(left: string, right: string): string {
    return createHash('sha256').update('\x01' + left + ':' + right).digest('hex');
  }

  /**
   * Builds a padded binary Merkle tree from raw leaf strings.
   */
  public buildTree(leaves: string[]): string {
    if (leaves.length === 0) {
      throw new Error('Cannot build Merkle tree from empty leaf list');
    }

    this.originalLeafCount = leaves.length;
    this.rawLeaves = [...leaves];

    let size = 1;
    let d = 0;
    while (size < leaves.length) {
      size <<= 1;
      d++;
    }
    this.paddedSize = size;
    this.depth = d;

    const emptyLeafHash = SuccinctMerkleMultiProof.hashLeaf('');
    const leafLevel: string[] = new Array(size);
    for (let i = 0; i < size; i++) {
      leafLevel[i] = i < leaves.length ? SuccinctMerkleMultiProof.hashLeaf(leaves[i]) : emptyLeafHash;
    }

    this.levels = [leafLevel];
    let current = leafLevel;

    while (current.length > 1) {
      const next: string[] = new Array(current.length >> 1);
      for (let i = 0; i < next.length; i++) {
        next[i] = SuccinctMerkleMultiProof.hashPair(current[2 * i], current[2 * i + 1]);
      }
      this.levels.push(next);
      current = next;
    }

    return this.getRoot();
  }

  public getRoot(): string {
    if (this.levels.length === 0) throw new Error('Tree not built');
    return this.levels[this.levels.length - 1][0];
  }

  public getDepth(): number {
    return this.depth;
  }

  public getLeafCount(): number {
    return this.originalLeafCount;
  }

  /**
   * Generates a minimal deduplicated Merkle multi-proof for the requested leaf indices.
   */
  public generateMultiProof(indices: number[]): MerkleMultiProof {
    if (this.levels.length === 0) {
      throw new Error('Tree must be built before generating multi-proof');
    }
    if (indices.length === 0) {
      throw new Error('Cannot generate multi-proof for empty index set');
    }

    // Deduplicate and sort ascending
    const sorted = Array.from(new Set(indices)).sort((a, b) => a - b);
    for (const idx of sorted) {
      if (idx < 0 || idx >= this.originalLeafCount) {
        throw new Error(`Leaf index ${idx} out of bounds [0, ${this.originalLeafCount})`);
      }
    }

    const proofHashes: string[] = [];
    const proofFlags: boolean[] = [];

    let levelIndices = [...sorted];

    for (let lvl = 0; lvl < this.depth; lvl++) {
      const nextLevelIndices: number[] = [];
      let p = 0;

      while (p < levelIndices.length) {
        const idx = levelIndices[p];
        const isLeft = idx % 2 === 0;
        const sibling = idx ^ 1;

        if (isLeft && p + 1 < levelIndices.length && levelIndices[p + 1] === sibling) {
          // Both siblings are already available from known leaves / child nodes
          proofFlags.push(true);
          nextLevelIndices.push(idx >> 1);
          p += 2;
        } else {
          // Sibling is not known; emit minimal auxiliary hash
          proofFlags.push(false);
          proofHashes.push(this.levels[lvl][sibling]);
          nextLevelIndices.push(idx >> 1);
          p += 1;
        }
      }

      levelIndices = nextLevelIndices;
    }

    return {
      leafIndices: sorted,
      proofHashes,
      proofFlags,
      treeDepth: this.depth,
      leafCount: this.originalLeafCount,
    };
  }

  /**
   * Computes exact bandwidth savings of the multi-proof vs naive individual proofs.
   */
  public computeCompressionStats(indices: number[]): MultiProofCompressionStats {
    const proof = this.generateMultiProof(indices);
    const subsetSize = proof.leafIndices.length;
    const naiveHashCount = subsetSize * this.depth;
    const multiProofHashCount = proof.proofHashes.length;
    const hashesSaved = Math.max(0, naiveHashCount - multiProofHashCount);
    const compressionRatio = naiveHashCount > 0 ? multiProofHashCount / naiveHashCount : 0;

    return {
      subsetSize,
      naiveHashCount,
      multiProofHashCount,
      hashesSaved,
      compressionRatio,
    };
  }

  /**
   * Stateless verifier reconstructing the Merkle root from leaves, auxiliary hashes, and flags.
   */
  public static verifyMultiProof(
    expectedRoot: string,
    leaves: MultiProofLeaf[],
    proof: MerkleMultiProof
  ): MultiProofVerificationResult {
    if (leaves.length === 0 || leaves.length !== proof.leafIndices.length) {
      return {
        isValid: false,
        reason: 'Leaf count mismatch between submitted leaves and proof',
        computedRoot: '',
        verifiedLeafCount: 0,
      };
    }

    // Sort leaves by index ascending and verify exact index match
    const sortedLeaves = [...leaves].sort((a, b) => a.index - b.index);
    for (let i = 0; i < sortedLeaves.length; i++) {
      if (sortedLeaves[i].index !== proof.leafIndices[i]) {
        return {
          isValid: false,
          reason: `Submitted leaf index ${sortedLeaves[i].index} does not match proof index ${proof.leafIndices[i]}`,
          computedRoot: '',
          verifiedLeafCount: 0,
        };
      }
    }

    let currentNodes = sortedLeaves.map((l) => ({
      index: l.index,
      hash: SuccinctMerkleMultiProof.hashLeaf(l.value),
    }));

    let proofPos = 0;
    let flagPos = 0;

    for (let lvl = 0; lvl < proof.treeDepth; lvl++) {
      const nextNodes: { index: number; hash: string }[] = [];
      let p = 0;

      while (p < currentNodes.length) {
        if (flagPos >= proof.proofFlags.length) {
          return {
            isValid: false,
            reason: 'Proof flags exhausted prematurely',
            computedRoot: '',
            verifiedLeafCount: 0,
          };
        }

        const combineComputed = proof.proofFlags[flagPos++];
        const node = currentNodes[p];

        if (combineComputed) {
          if (p + 1 >= currentNodes.length || node.index % 2 !== 0 || currentNodes[p + 1].index !== node.index + 1) {
            return {
              isValid: false,
              reason: 'Invalid sibling pairing flag in multi-proof',
              computedRoot: '',
              verifiedLeafCount: 0,
            };
          }
          const parentHash = SuccinctMerkleMultiProof.hashPair(node.hash, currentNodes[p + 1].hash);
          nextNodes.push({ index: node.index >> 1, hash: parentHash });
          p += 2;
        } else {
          if (proofPos >= proof.proofHashes.length) {
            return {
              isValid: false,
              reason: 'Auxiliary proof hashes exhausted prematurely',
              computedRoot: '',
              verifiedLeafCount: 0,
            };
          }
          const siblingHash = proof.proofHashes[proofPos++];
          const parentHash =
            node.index % 2 === 0
              ? SuccinctMerkleMultiProof.hashPair(node.hash, siblingHash)
              : SuccinctMerkleMultiProof.hashPair(siblingHash, node.hash);
          nextNodes.push({ index: node.index >> 1, hash: parentHash });
          p += 1;
        }
      }

      currentNodes = nextNodes;
    }

    if (proofPos !== proof.proofHashes.length || flagPos !== proof.proofFlags.length) {
      return {
        isValid: false,
        reason: 'Unused trailing hashes or flags in multi-proof',
        computedRoot: '',
        verifiedLeafCount: 0,
      };
    }

    if (currentNodes.length !== 1) {
      return {
        isValid: false,
        reason: 'Failed to converge to single Merkle root',
        computedRoot: '',
        verifiedLeafCount: 0,
      };
    }

    const computedRoot = currentNodes[0].hash;
    if (computedRoot !== expectedRoot) {
      return {
        isValid: false,
        reason: 'Computed Merkle root does not match expected root',
        computedRoot,
        verifiedLeafCount: 0,
      };
    }

    return {
      isValid: true,
      computedRoot,
      verifiedLeafCount: sortedLeaves.length,
    };
  }
}
