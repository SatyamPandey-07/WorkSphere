/**
 * @file ZeroKnowledgeMerkleSparseNonInclusionProver.ts
 * @description 256-Bit Sparse Merkle Tree (SMT) with Compact Bitmask Proofs, Zero-Knowledge
 * Non-Inclusion (Empty-Leaf) Verification, Verified Atomic Key-Value State Transitions,
 * Batch Auditing, and Portable JSON Serialization.
 * Uses deterministic empty-subtree hashes H_empty[0..256] so an arbitrarily huge 2^256 keyspace
 * requires only O(k * 256) sparse storage and compresses default siblings via a 256-bit mask.
 */

import { createHash } from 'node:crypto';

export interface SparseMerkleProof {
  key: string;
  keyHashHex: string;
  included: boolean;
  value: string | null;
  valueHashHex: string;
  nonDefaultBitmapHex: string;
  nonDefaultSiblings: string[];
  rootHash: string;
}

export interface SparseStateTransitionProof {
  key: string;
  oldRootHash: string;
  newRootHash: string;
  oldValue: string | null;
  newValue: string | null;
  preProof: SparseMerkleProof;
  postProof: SparseMerkleProof;
  transitionDigest: string;
}

const TREE_DEPTH = 256;
const EMPTY_LEAF_HASH = createHash('sha256').update('WorkSphere::SMT::EmptyLeaf').digest('hex');

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hashKey(key: string): Buffer {
  return createHash('sha256').update(`WorkSphere::SMT::Key|${key}`).digest();
}

function hashLeafValue(keyHashHex: string, value: string): string {
  return sha256Hex(`WorkSphere::SMT::Leaf|${keyHashHex}|${value}`);
}

function hashPair(leftHex: string, rightHex: string): string {
  return createHash('sha256')
    .update('\x01')
    .update(Buffer.from(leftHex, 'hex'))
    .update(Buffer.from(rightHex, 'hex'))
    .digest('hex');
}

function getKeyBit(keyHash: Buffer, depthFromRoot: number): 0 | 1 {
  const byteIndex = depthFromRoot >> 3;
  const bitOffset = 7 - (depthFromRoot & 7);
  return ((keyHash[byteIndex] >> bitOffset) & 1) === 1 ? 1 : 0;
}

function buildDefaultHashes(): string[] {
  const defaults = new Array<string>(TREE_DEPTH + 1);
  defaults[TREE_DEPTH] = EMPTY_LEAF_HASH;
  for (let d = TREE_DEPTH - 1; d >= 0; d--) {
    defaults[d] = hashPair(defaults[d + 1], defaults[d + 1]);
  }
  return defaults;
}

const DEFAULT_SUBTREE_HASHES = buildDefaultHashes();

/**
 * 256-Bit Sparse Merkle Tree Prover & Verifier supporting inclusion, non-inclusion,
 * bitmap-compressed proofs, and atomic state-root transition verification.
 */
export class ZeroKnowledgeMerkleSparseNonInclusionProver {
  // Stores only non-default internal/leaf nodes keyed by "depth:prefixHex"
  private readonly nodes: Map<string, string> = new Map();
  private readonly kvStore: Map<string, string> = new Map();
  private readonly keyHashToKey: Map<string, string> = new Map();
  private rootHash: string = DEFAULT_SUBTREE_HASHES[0];

  public getRootHash(): string {
    return this.rootHash;
  }

  public getEntryCount(): number {
    return this.kvStore.size;
  }

  public getDefaultEmptyRoot(): string {
    return DEFAULT_SUBTREE_HASHES[0];
  }

  private prefixPath(keyHash: Buffer, depth: number): string {
    if (depth === 0) return 'root';
    let bits = '';
    for (let i = 0; i < depth; i++) {
      bits += getKeyBit(keyHash, i);
    }
    return `${depth}:${bits}`;
  }

  private siblingPath(keyHash: Buffer, depth: number): string {
    let bits = '';
    for (let i = 0; i < depth - 1; i++) {
      bits += getKeyBit(keyHash, i);
    }
    const flipped = getKeyBit(keyHash, depth - 1) === 0 ? '1' : '0';
    return `${depth}:${bits}${flipped}`;
  }

  private getNode(pathKey: string, depth: number): string {
    return this.nodes.get(pathKey) ?? DEFAULT_SUBTREE_HASHES[depth];
  }

  private setNode(pathKey: string, depth: number, hashHex: string): void {
    if (hashHex === DEFAULT_SUBTREE_HASHES[depth]) {
      this.nodes.delete(pathKey);
    } else {
      this.nodes.set(pathKey, hashHex);
    }
  }

  /**
   * Inserts or updates a key-value pair and recomputes all 256 ancestor hashes along the path.
   */
  public set(key: string, value: string): string {
    const kh = hashKey(key);
    const khHex = kh.toString('hex');
    const leafHash = hashLeafValue(khHex, value);

    this.kvStore.set(key, value);
    this.keyHashToKey.set(khHex, key);
    this.updatePath(kh, leafHash);
    return this.rootHash;
  }

  /**
   * Deletes a key by restoring its leaf to EMPTY_LEAF_HASH and pruning default subtrees.
   */
  public delete(key: string): string {
    const kh = hashKey(key);
    const khHex = kh.toString('hex');
    this.kvStore.delete(key);
    this.keyHashToKey.delete(khHex);
    this.updatePath(kh, EMPTY_LEAF_HASH);
    return this.rootHash;
  }

  private updatePath(keyHash: Buffer, leafHash: string): void {
    let currentHash = leafHash;
    this.setNode(this.prefixPath(keyHash, TREE_DEPTH), TREE_DEPTH, currentHash);

    for (let d = TREE_DEPTH; d >= 1; d--) {
      const bit = getKeyBit(keyHash, d - 1);
      const sibling = this.getNode(this.siblingPath(keyHash, d), d);
      currentHash = bit === 0 ? hashPair(currentHash, sibling) : hashPair(sibling, currentHash);
      this.setNode(this.prefixPath(keyHash, d - 1), d - 1, currentHash);
    }
    this.rootHash = currentHash;
  }

  /**
   * Generates a compact bitmap-compressed inclusion OR non-inclusion proof for `key`.
   * Only non-default sibling hashes are serialized in `nonDefaultSiblings`.
   */
  public generateProof(key: string): SparseMerkleProof {
    const kh = hashKey(key);
    const khHex = kh.toString('hex');
    const stored = this.kvStore.get(key);
    const included = stored !== undefined;
    const value = included ? stored : null;
    const valueHashHex = included ? hashLeafValue(khHex, stored) : EMPTY_LEAF_HASH;

    const bitmap = Buffer.alloc(32, 0);
    const nonDefaultSiblings: string[] = [];

    for (let d = TREE_DEPTH; d >= 1; d--) {
      const sib = this.getNode(this.siblingPath(keyHashOrThrow(kh), d), d);
      if (sib !== DEFAULT_SUBTREE_HASHES[d]) {
        const idx = TREE_DEPTH - d; // 0 = bottom leaf sibling, 255 = top root child sibling
        bitmap[idx >> 3] |= 1 << (idx & 7);
        nonDefaultSiblings.push(sib);
      }
    }

    return {
      key,
      keyHashHex: khHex,
      included,
      value,
      valueHashHex,
      nonDefaultBitmapHex: bitmap.toString('hex'),
      nonDefaultSiblings,
      rootHash: this.rootHash,
    };
  }

  /**
   * Publicly verifies a compact Sparse Merkle inclusion or non-inclusion proof against `expectedRoot`.
   */
  public verifyProof(
    proof: SparseMerkleProof,
    expectedRootHash: string
  ): { valid: boolean; reason?: string } {
    const kh = hashKey(proof.key);
    const khHex = kh.toString('hex');
    if (khHex !== proof.keyHashHex) {
      return { valid: false, reason: 'Key hash mismatch' };
    }

    if (proof.included) {
      if (proof.value === null) {
        return { valid: false, reason: 'Included proof missing value' };
      }
      if (hashLeafValue(khHex, proof.value) !== proof.valueHashHex) {
        return { valid: false, reason: 'Included leaf value hash mismatch' };
      }
    } else {
      if (proof.value !== null || proof.valueHashHex !== EMPTY_LEAF_HASH) {
        return { valid: false, reason: 'Non-inclusion proof must open to EMPTY_LEAF_HASH' };
      }
    }

    const bitmap = Buffer.from(proof.nonDefaultBitmapHex, 'hex');
    if (bitmap.length !== 32) {
      return { valid: false, reason: 'Invalid 256-bit compression bitmap length' };
    }

    let siblingCursor = 0;
    let currentHash = proof.valueHashHex;

    for (let d = TREE_DEPTH; d >= 1; d--) {
      const idx = TREE_DEPTH - d;
      const isNonDefault = ((bitmap[idx >> 3] >> (idx & 7)) & 1) === 1;
      let sibling: string;
      if (isNonDefault) {
        if (siblingCursor >= proof.nonDefaultSiblings.length) {
          return { valid: false, reason: 'Bitmap references missing non-default sibling' };
        }
        sibling = proof.nonDefaultSiblings[siblingCursor++];
      } else {
        sibling = DEFAULT_SUBTREE_HASHES[d];
      }

      const bit = getKeyBit(kh, d - 1);
      currentHash = bit === 0 ? hashPair(currentHash, sibling) : hashPair(sibling, currentHash);
    }

    if (siblingCursor !== proof.nonDefaultSiblings.length) {
      return { valid: false, reason: 'Unused trailing sibling hashes in proof' };
    }
    if (currentHash !== expectedRootHash || proof.rootHash !== expectedRootHash) {
      return { valid: false, reason: 'Reconstructed Sparse Merkle root mismatch' };
    }

    return { valid: true };
  }

  /**
   * Executes an atomic key update (insert, overwrite, or delete when newValue === null)
   * and returns a publicly verifiable state-transition proof linking oldRoot -> newRoot.
   */
  public applyVerifiedTransition(
    key: string,
    newValue: string | null
  ): SparseStateTransitionProof {
    const oldRootHash = this.rootHash;
    const oldValue = this.kvStore.get(key) ?? null;
    const preProof = this.generateProof(key);

    if (newValue === null) {
      this.delete(key);
    } else {
      this.set(key, newValue);
    }

    const newRootHash = this.rootHash;
    const postProof = this.generateProof(key);
    const transitionDigest = sha256Hex(
      `WorkSphere::SMTTransition|${key}|${oldRootHash}|${newRootHash}|${String(oldValue)}|${String(newValue)}`
    );

    return {
      key,
      oldRootHash,
      newRootHash,
      oldValue,
      newValue,
      preProof,
      postProof,
      transitionDigest,
    };
  }

  /**
   * Verifies that a state transition modified ONLY `proof.key` from oldValue -> newValue
   * by confirming BOTH proofs verify AND share the EXACT same sibling bitmap & sibling hashes!
   */
  public verifyStateTransition(proof: SparseStateTransitionProof): { valid: boolean; reason?: string } {
    if (proof.preProof.key !== proof.key || proof.postProof.key !== proof.key) {
      return { valid: false, reason: 'Transition key mismatch' };
    }
    if (proof.preProof.value !== proof.oldValue || proof.postProof.value !== proof.newValue) {
      return { valid: false, reason: 'Transition value mismatch' };
    }
    const preCheck = this.verifyProof(proof.preProof, proof.oldRootHash);
    if (!preCheck.valid) {
      return { valid: false, reason: `Pre-state proof failed: ${preCheck.reason}` };
    }
    const postCheck = this.verifyProof(proof.postProof, proof.newRootHash);
    if (!postCheck.valid) {
      return { valid: false, reason: `Post-state proof failed: ${postCheck.reason}` };
    }

    // Siblings along the path MUST be identical between pre and post proofs
    // (guarantees no unrelated leaf in the 2^256 tree was silently mutated!)
    if (proof.preProof.nonDefaultBitmapHex !== proof.postProof.nonDefaultBitmapHex) {
      return { valid: false, reason: 'Sibling bitmap mutated outside target key path' };
    }
    if (
      proof.preProof.nonDefaultSiblings.length !== proof.postProof.nonDefaultSiblings.length ||
      proof.preProof.nonDefaultSiblings.some((s, i) => s !== proof.postProof.nonDefaultSiblings[i])
    ) {
      return { valid: false, reason: 'Sibling hashes mutated outside target key path' };
    }

    return { valid: true };
  }

  /**
   * Batch-verifies mixed inclusion and non-inclusion proofs against one root snapshot.
   */
  public batchVerifyProofs(
    proofs: readonly SparseMerkleProof[],
    expectedRootHash: string
  ): {
    allValid: boolean;
    includedKeys: string[];
    excludedKeys: string[];
    failedKeys: string[];
  } {
    const includedKeys: string[] = [];
    const excludedKeys: string[] = [];
    const failedKeys: string[] = [];

    for (const p of proofs) {
      if (this.verifyProof(p, expectedRootHash).valid) {
        if (p.included) includedKeys.push(p.key);
        else excludedKeys.push(p.key);
      } else {
        failedKeys.push(p.key);
      }
    }

    return {
      allValid: proofs.length > 0 && failedKeys.length === 0,
      includedKeys,
      excludedKeys,
      failedKeys,
    };
  }

  public serializeProof(proof: SparseMerkleProof): string {
    return JSON.stringify(proof);
  }

  public deserializeProof(payload: string): SparseMerkleProof {
    return JSON.parse(payload) as SparseMerkleProof;
  }
}

function keyHashOrThrow(buf: Buffer): Buffer {
  if (buf.length !== 32) throw new Error('Expected 32-byte key hash');
  return buf;
}
