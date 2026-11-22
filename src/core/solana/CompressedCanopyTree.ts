/**
 * @file CompressedCanopyTree.ts
 * @description Solana SPL Account Compression canopy-cached concurrent Merkle tree.
 * Implements on-chain canopy caching to reduce transaction proof size from O(D) to O(D - C),
 * concurrent changelog ring buffers for non-blocking state updates, and micro-escrow leaf hashing.
 */

import { createHash } from 'crypto';

/**
 * Empty node constant representation (32-byte zero hash).
 */
export const EMPTY_NODE = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Truncated proof and canopy resolution output.
 */
export interface TruncatedMerkleProof {
  readonly leafIndex: number;
  readonly truncatedProof: string[]; // Length = maxDepth - canopyDepth
  readonly fullProofLength: number; // Original maxDepth
  readonly canopyDepth: number;
  readonly root: string;
}

/**
 * Changelog entry recording historical state changes in the ring buffer.
 */
export interface ChangelogRecord {
  readonly root: string;
  readonly leafIndex: number;
  readonly previousLeaf: string;
  readonly newLeaf: string;
  readonly timestamp: number;
}

/**
 * Leaf asset payload structure for micro-escrow and compressed NFTs.
 */
export interface CompressedAssetLeaf {
  readonly assetId: string;
  readonly owner: string;
  readonly delegate: string;
  readonly amount: bigint;
  readonly nonce: bigint;
  readonly dataHash: string;
}

/**
 * Computes node hash H(left || right) using SHA-256.
 */
export function hashNodes(left: string, right: string): string {
  return createHash('sha256')
    .update(Buffer.from(left, 'hex'))
    .update(Buffer.from(right, 'hex'))
    .digest('hex');
}

/**
 * Computes deterministic zero-node hashes for tree depth levels.
 */
export function computeZeroHashes(maxDepth: number): string[] {
  const zeros = new Array<string>(maxDepth + 1);
  zeros[0] = EMPTY_NODE;
  for (let d = 1; d <= maxDepth; d++) {
    zeros[d] = hashNodes(zeros[d - 1], zeros[d - 1]);
  }
  return zeros;
}

/**
 * Solana Concurrent Merkle Tree with Canopy Caching.
 */
export class CompressedCanopyTree {
  public readonly maxDepth: number;
  public readonly maxBufferSize: number;
  public readonly canopyDepth: number;

  private readonly zeroHashes: string[];
  private readonly leaves: Map<number, string>;
  private readonly internalNodes: Map<string, string>; // key: `${level}_${index}` -> hash
  private readonly changelogRing: ChangelogRecord[];
  private readonly recentRoots: string[];
  private nextIndex: number;
  private currentRoot: string;

  constructor(maxDepth: number = 14, maxBufferSize: number = 64, canopyDepth: number = 4) {
    if (canopyDepth > maxDepth) {
      throw new Error(`CompressedCanopyTree: canopyDepth (${canopyDepth}) cannot exceed maxDepth (${maxDepth})`);
    }
    if (maxDepth < 1 || maxDepth > 30) {
      throw new Error(`CompressedCanopyTree: maxDepth must be between 1 and 30, received ${maxDepth}`);
    }

    this.maxDepth = maxDepth;
    this.maxBufferSize = maxBufferSize;
    this.canopyDepth = canopyDepth;

    this.zeroHashes = computeZeroHashes(maxDepth);
    this.leaves = new Map<number, string>();
    this.internalNodes = new Map<string, string>();
    this.changelogRing = [];
    this.recentRoots = [];
    this.nextIndex = 0;
    this.currentRoot = this.zeroHashes[maxDepth];

    // Seed initial root into recent roots buffer
    this.recentRoots.push(this.currentRoot);
  }

  /**
   * Hashes a compressed asset / micro-escrow leaf according to SPL Bubblegum specification.
   */
  public static hashLeafData(leaf: CompressedAssetLeaf): string {
    return createHash('sha256')
      .update(leaf.assetId)
      .update(leaf.owner)
      .update(leaf.delegate)
      .update(leaf.amount.toString(16))
      .update(leaf.nonce.toString(16))
      .update(leaf.dataHash)
      .digest('hex');
  }

  /**
   * Returns current Merkle root hash.
   */
  public getRoot(): string {
    return this.currentRoot;
  }

  /**
   * Returns number of leaves inserted.
   */
  public getCount(): number {
    return this.nextIndex;
  }

  /**
   * Checks whether a given root is valid in the recent roots buffer.
   */
  public isValidRoot(root: string): boolean {
    return this.recentRoots.includes(root);
  }

  /**
   * Appends a new leaf to the tree.
   */
  public append(leafHash: string): { index: number; newRoot: string } {
    const maxCapacity = 1 << this.maxDepth;
    if (this.nextIndex >= maxCapacity) {
      throw new Error(`CompressedCanopyTree: Tree capacity exceeded (max: ${maxCapacity})`);
    }

    const index = this.nextIndex;
    const prevLeaf = this.leaves.get(index) ?? this.zeroHashes[0];

    this.leaves.set(index, leafHash);
    this.nextIndex++;

    const newRoot = this.recomputePath(index, leafHash);
    this.recordChangelog(index, prevLeaf, leafHash, newRoot);

    return { index, newRoot };
  }

  /**
   * Updates an existing leaf given a valid truncated Merkle proof.
   */
  public updateLeaf(
    leafIndex: number,
    currentLeaf: string,
    newLeaf: string,
    truncatedProof: string[],
    rootToVerify?: string
  ): string {
    const activeRoot = rootToVerify ?? this.currentRoot;
    if (!this.isValidRoot(activeRoot)) {
      throw new Error('CompressedCanopyTree: Provided root is not in recent roots buffer');
    }

    const isValid = this.verifyTruncatedProof(leafIndex, currentLeaf, truncatedProof, activeRoot);
    if (!isValid) {
      throw new Error('CompressedCanopyTree: Truncated Merkle proof verification failed');
    }

    this.leaves.set(leafIndex, newLeaf);
    const newRoot = this.recomputePath(leafIndex, newLeaf);
    this.recordChangelog(leafIndex, currentLeaf, newLeaf, newRoot);

    return newRoot;
  }

  /**
   * Generates a truncated Merkle proof for a leaf index.
   * Proof length is exactly (maxDepth - canopyDepth).
   */
  public getTruncatedProof(leafIndex: number): TruncatedMerkleProof {
    const truncatedLength = this.maxDepth - this.canopyDepth;
    const truncatedProof: string[] = [];
    let curIdx = leafIndex;

    for (let level = 0; level < truncatedLength; level++) {
      const isRight = curIdx % 2 === 1;
      const siblingIdx = isRight ? curIdx - 1 : curIdx + 1;
      const siblingHash = this.getNodeHash(level, siblingIdx);
      truncatedProof.push(siblingHash);
      curIdx = Math.floor(curIdx / 2);
    }

    return {
      leafIndex,
      truncatedProof,
      fullProofLength: this.maxDepth,
      canopyDepth: this.canopyDepth,
      root: this.currentRoot,
    };
  }

  /**
   * Verifies a truncated Merkle proof using the cached canopy nodes up to the root.
   */
  public verifyTruncatedProof(
    leafIndex: number,
    leafHash: string,
    truncatedProof: string[],
    expectedRoot?: string
  ): boolean {
    const requiredLength = this.maxDepth - this.canopyDepth;
    if (truncatedProof.length !== requiredLength) {
      return false;
    }

    let currentHash = leafHash;
    let curIdx = leafIndex;

    // Phase 1: Ascend lower levels using transaction proof
    for (let level = 0; level < requiredLength; level++) {
      const sibling = truncatedProof[level];
      const isRight = curIdx % 2 === 1;
      currentHash = isRight ? hashNodes(sibling, currentHash) : hashNodes(currentHash, sibling);
      curIdx = Math.floor(curIdx / 2);
    }

    // Phase 2: Ascend upper levels using cached canopy nodes
    for (let level = requiredLength; level < this.maxDepth; level++) {
      const isRight = curIdx % 2 === 1;
      const siblingIdx = isRight ? curIdx - 1 : curIdx + 1;
      const sibling = this.getNodeHash(level, siblingIdx);
      currentHash = isRight ? hashNodes(sibling, currentHash) : hashNodes(currentHash, sibling);
      curIdx = Math.floor(curIdx / 2);
    }

    const targetRoot = expectedRoot ?? this.currentRoot;
    return currentHash === targetRoot;
  }

  /**
   * Retrieves an on-chain canopy node at specified level and index.
   */
  public getCanopyNode(level: number, index: number): string {
    const minCanopyLevel = this.maxDepth - this.canopyDepth;
    if (level < minCanopyLevel || level > this.maxDepth) {
      throw new Error(`getCanopyNode: Level ${level} is outside canopy window [${minCanopyLevel}, ${this.maxDepth}]`);
    }
    return this.getNodeHash(level, index);
  }

  /**
   * Returns recent changelog history from the concurrent ring buffer.
   */
  public getChangelog(): readonly ChangelogRecord[] {
    return [...this.changelogRing];
  }

  // --- Internal Node & Path Computation Helpers ---

  private getNodeHash(level: number, index: number): string {
    if (level === 0) {
      return this.leaves.get(index) ?? this.zeroHashes[0];
    }
    const key = `${level}_${index}`;
    return this.internalNodes.get(key) ?? this.zeroHashes[level];
  }

  private setNodeHash(level: number, index: number, hash: string): void {
    const key = `${level}_${index}`;
    this.internalNodes.set(key, hash);
  }

  private recomputePath(leafIndex: number, newLeafHash: string): string {
    let currentHash = newLeafHash;
    let curIdx = leafIndex;

    for (let level = 0; level < this.maxDepth; level++) {
      this.setNodeHash(level, curIdx, currentHash);
      const isRight = curIdx % 2 === 1;
      const siblingIdx = isRight ? curIdx - 1 : curIdx + 1;
      const sibling = this.getNodeHash(level, siblingIdx);

      currentHash = isRight ? hashNodes(sibling, currentHash) : hashNodes(currentHash, sibling);
      curIdx = Math.floor(curIdx / 2);
    }

    this.currentRoot = currentHash;
    this.setNodeHash(this.maxDepth, 0, currentHash);
    return currentHash;
  }

  private recordChangelog(
    leafIndex: number,
    previousLeaf: string,
    newLeaf: string,
    newRoot: string
  ): void {
    const record: ChangelogRecord = {
      root: newRoot,
      leafIndex,
      previousLeaf,
      newLeaf,
      timestamp: Date.now(),
    };

    this.changelogRing.push(record);
    if (this.changelogRing.length > this.maxBufferSize) {
      this.changelogRing.shift();
    }

    this.recentRoots.push(newRoot);
    if (this.recentRoots.length > this.maxBufferSize) {
      this.recentRoots.shift();
    }
  }
}
