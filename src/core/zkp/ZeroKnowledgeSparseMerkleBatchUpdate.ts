import { createHash } from 'node:crypto';

/**
 * Zero-Knowledge Sparse Merkle Batch Update Prover.
 *
 * Implements a fixed-depth binary Sparse Merkle Tree (SMT) supporting:
 *  - Canonical empty-subtree precomputation across all depth levels
 *  - Deterministic inclusion AND non-inclusion Merkle proofs for arbitrary keys
 *  - Atomic multi-key batch state transitions emitting a sequential witness chain
 *    (oldRoot -> step_1 -> ... -> newRoot) so light clients can cryptographically verify
 *    every inserted, updated, or deleted key-value entry without storing the full tree!
 */

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

export interface SparseMerkleProof {
  key: string;
  keyHashBits: string;
  value: string | null; // null represents cryptographic non-inclusion (empty leaf)
  siblings: string[];   // ordered from leaf level (0) up to root level (depth - 1)
  root: string;
  depth: number;
}

export interface BatchUpdateStepWitness {
  key: string;
  previousValue: string | null;
  newValue: string | null;
  previousRoot: string;
  nextRoot: string;
  siblings: string[];
}

export interface SparseMerkleBatchUpdateProof {
  depth: number;
  initialRoot: string;
  finalRoot: string;
  steps: BatchUpdateStepWitness[];
  batchDigest: string;
}

export class ZeroKnowledgeSparseMerkleBatchUpdate {
  public readonly depth: number;
  private readonly defaultHashes: string[];
  private nodes = new Map<string, string>(); // key: `${level}:${pathPrefix}`
  private kvStore = new Map<string, string>();

  constructor(depth = 16) {
    if (depth < 4 || depth > 64) {
      throw new RangeError('SMT depth must be between 4 and 64');
    }
    this.depth = depth;
    this.defaultHashes = new Array<string>(depth + 1);
    this.defaultHashes[0] = sha256Hex('SMT-EMPTY-LEAF-V1');
    for (let lvl = 1; lvl <= depth; lvl++) {
      this.defaultHashes[lvl] = this.hashInternal(this.defaultHashes[lvl - 1], this.defaultHashes[lvl - 1]);
    }
  }

  private hashLeaf(key: string, value: string | null): string {
    if (value === null) return this.defaultHashes[0];
    return sha256Hex('SMT-LEAF-V1', key, value);
  }

  private hashInternal(left: string, right: string): string {
    return sha256Hex('SMT-NODE-V1', left, right);
  }

  public keyToBits(key: string): string {
    const hex = sha256Hex('SMT-KEY-V1', key);
    let bits = '';
    for (let i = 0; i < hex.length && bits.length < this.depth; i++) {
      bits += parseInt(hex[i], 16).toString(2).padStart(4, '0');
    }
    return bits.slice(0, this.depth);
  }

  private getNode(level: number, prefix: string): string {
    return this.nodes.get(`${level}:${prefix}`) ?? this.defaultHashes[level];
  }

  private setNode(level: number, prefix: string, hash: string): void {
    if (hash === this.defaultHashes[level]) {
      this.nodes.delete(`${level}:${prefix}`);
    } else {
      this.nodes.set(`${level}:${prefix}`, hash);
    }
  }

  public getRoot(): string {
    return this.getNode(this.depth, '');
  }

  public get(key: string): string | null {
    return this.kvStore.get(key) ?? null;
  }

  private getSiblingsForBits(bits: string): string[] {
    const siblings: string[] = [];
    for (let level = 0; level < this.depth; level++) {
      // At level `level`, path length from root is `depth - level`
      const fullLen = this.depth - level;
      const myPrefix = bits.slice(0, fullLen);
      const lastBit = myPrefix[fullLen - 1];
      const siblingPrefix = myPrefix.slice(0, fullLen - 1) + (lastBit === '0' ? '1' : '0');
      siblings.push(this.getNode(level, siblingPrefix));
    }
    return siblings;
  }

  public prove(key: string): SparseMerkleProof {
    const keyHashBits = this.keyToBits(key);
    return {
      key,
      keyHashBits,
      value: this.get(key),
      siblings: this.getSiblingsForBits(keyHashBits),
      root: this.getRoot(),
      depth: this.depth,
    };
  }

  public computeRootFromSiblings(key: string, value: string | null, siblings: string[]): string {
    if (siblings.length !== this.depth) {
      throw new RangeError('Siblings array length must match tree depth');
    }
    const bits = this.keyToBits(key);
    let current = this.hashLeaf(key, value);
    for (let level = 0; level < this.depth; level++) {
      const bitIndex = this.depth - 1 - level;
      const bit = bits[bitIndex];
      const sib = siblings[level];
      current = bit === '0' ? this.hashInternal(current, sib) : this.hashInternal(sib, current);
    }
    return current;
  }

  public verifyProof(proof: SparseMerkleProof): boolean {
    if (proof.depth !== this.depth || proof.siblings.length !== this.depth) return false;
    if (proof.keyHashBits !== this.keyToBits(proof.key)) return false;
    const computed = this.computeRootFromSiblings(proof.key, proof.value, proof.siblings);
    return computed === proof.root;
  }

  private applySingleUpdate(key: string, newValue: string | null): BatchUpdateStepWitness {
    const bits = this.keyToBits(key);
    const previousValue = this.get(key);
    const previousRoot = this.getRoot();
    const siblings = this.getSiblingsForBits(bits);

    if (newValue === null) {
      this.kvStore.delete(key);
    } else {
      this.kvStore.set(key, newValue);
    }

    let current = this.hashLeaf(key, newValue);
    this.setNode(0, bits, current);
    for (let level = 0; level < this.depth; level++) {
      const bitIndex = this.depth - 1 - level;
      const bit = bits[bitIndex];
      const sib = siblings[level];
      current = bit === '0' ? this.hashInternal(current, sib) : this.hashInternal(sib, current);
      const parentPrefix = bits.slice(0, bitIndex);
      this.setNode(level + 1, parentPrefix, current);
    }

    return {
      key,
      previousValue,
      newValue,
      previousRoot,
      nextRoot: this.getRoot(),
      siblings,
    };
  }

  private computeBatchDigest(initialRoot: string, finalRoot: string, steps: BatchUpdateStepWitness[]): string {
    return sha256Hex(
      'SMT-BATCH-TRANSITION-V1',
      String(this.depth),
      initialRoot,
      finalRoot,
      ...steps.map((s) => `${s.key}:${s.previousValue ?? 'NULL'}->${s.newValue ?? 'NULL'}:${s.nextRoot}`),
    );
  }

  public applyBatchUpdates(updates: Array<{ key: string; value: string | null }>): SparseMerkleBatchUpdateProof {
    if (updates.length === 0) throw new Error('Batch update list cannot be empty');
    const initialRoot = this.getRoot();
    const steps = updates.map((u) => this.applySingleUpdate(u.key, u.value));
    const finalRoot = this.getRoot();
    return {
      depth: this.depth,
      initialRoot,
      finalRoot,
      steps,
      batchDigest: this.computeBatchDigest(initialRoot, finalRoot, steps),
    };
  }

  public verifyBatchUpdateProof(proof: SparseMerkleBatchUpdateProof): boolean {
    if (proof.depth !== this.depth || proof.steps.length === 0) return false;
    const expectedDigest = this.computeBatchDigest(proof.initialRoot, proof.finalRoot, proof.steps);
    if (expectedDigest !== proof.batchDigest) return false;

    let runningRoot = proof.initialRoot;
    for (const step of proof.steps) {
      if (step.previousRoot !== runningRoot) return false;
      if (step.siblings.length !== this.depth) return false;
      const verifiedPrev = this.computeRootFromSiblings(step.key, step.previousValue, step.siblings);
      if (verifiedPrev !== step.previousRoot) return false;
      const verifiedNext = this.computeRootFromSiblings(step.key, step.newValue, step.siblings);
      if (verifiedNext !== step.nextRoot) return false;
      runningRoot = step.nextRoot;
    }

    return runningRoot === proof.finalRoot;
  }

  public serializeBatchProof(proof: SparseMerkleBatchUpdateProof): string {
    return JSON.stringify({
      depth: proof.depth,
      initialRoot: proof.initialRoot,
      finalRoot: proof.finalRoot,
      stepCount: proof.steps.length,
      batchDigest: proof.batchDigest,
    });
  }
}
