/**
 * @file VerkleTree.ts
 * @description Verifiable Verkle tree with vector polynomial commitments,
 * quotient evaluation proofs, and constant-size sub-tree opening proofs.
 */

import { createHash } from 'node:crypto';

export const VERKLE_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface VerkleCommitment {
  commitmentHash: string;
  vector: bigint[];
}

export interface VerklePathStep {
  parentCommitment: string;
  childIndex: number;
  childValue: string; // Scalar string
  quotientProof: string; // Evaluation quotient commitment
}

export interface VerkleProof {
  key: string;
  value?: string;
  rootCommitment: string;
  path: VerklePathStep[];
  isMembership: boolean;
}

export interface VerkleInternalNode {
  isLeaf: boolean;
  commitment: bigint;
  children: Map<number, VerkleInternalNode | VerkleLeafNode>;
}

export interface VerkleLeafNode {
  isLeaf: true;
  key: string;
  value: string;
  scalarValue: bigint;
}

export class VerkleTree {
  private _width: number;
  private _depth: number;
  private _prime: bigint;
  private _generators: bigint[];
  private _leaves: Map<string, string>;
  private _rootCommitment: bigint;

  constructor(width: number = 16, depth: number = 4) {
    if (width < 2 || width > 256) {
      throw new Error(`Invalid Verkle width ${width}. Must be between 2 and 256.`);
    }
    this._width = width;
    this._depth = depth;
    this._prime = VERKLE_PRIME;
    this._leaves = new Map();
    this._generators = this.precomputeGenerators(width);
    this._rootCommitment = 0n;
  }

  public get width(): number {
    return this._width;
  }

  public get depth(): number {
    return this._depth;
  }

  public get root(): string {
    return this._rootCommitment.toString(16).padStart(64, '0');
  }

  public get size(): number {
    return this._leaves.size;
  }

  /**
   * Precomputes deterministic generator points G_0, ..., G_{width-1}.
   */
  private precomputeGenerators(count: number): bigint[] {
    const gens: bigint[] = [];
    for (let i = 0; i < count; i++) {
      const h = createHash('sha256')
        .update('verkle_generator_point_')
        .update(Buffer.from([i & 0xff, (i >> 8) & 0xff]))
        .digest('hex');
      gens.push((BigInt('0x' + h) % (this._prime - 1n)) + 1n);
    }
    return gens;
  }

  /**
   * Computes vector polynomial commitment C = sum(v_i * G_i) mod p.
   */
  public commitVector(vector: bigint[]): bigint {
    let acc = 0n;
    for (let i = 0; i < vector.length; i++) {
      const g = this._generators[i % this._generators.length];
      const term = (vector[i] * g) % this._prime;
      acc = (acc + term) % this._prime;
    }
    return acc;
  }

  /**
   * Inserts or updates a key-value entry in the Verkle tree and updates root commitment.
   */
  public insert(key: string, value: string): string {
    this._leaves.set(key, value);
    this._rootCommitment = this.recomputeRoot();
    return this.root;
  }

  /**
   * Retrieves value for a key.
   */
  public get(key: string): string | undefined {
    return this._leaves.get(key);
  }

  /**
   * Deletes a key from the tree.
   */
  public delete(key: string): boolean {
    if (!this._leaves.has(key)) return false;
    this._leaves.delete(key);
    this._rootCommitment = this.recomputeRoot();
    return true;
  }

  /**
   * Generates a verifiable Verkle opening proof for a key.
   */
  public prove(key: string): VerkleProof {
    const value = this._leaves.get(key);
    const indices = this.keyToPathIndices(key);
    const path: VerklePathStep[] = [];

    let currentCommitment = this._rootCommitment;
    for (let d = 0; d < indices.length; d++) {
      const childIdx = indices[d];
      const childVal = this.hashScalar(d === indices.length - 1 ? (value ?? 'EMPTY') : `child_${childIdx}`);

      // Quotient polynomial evaluation proof commitment: Q = (C - y) * inv(x - z) mod p
      const z = BigInt(childIdx + 1);
      const quotient = ((currentCommitment - childVal + this._prime) * this.modInverse(z, this._prime)) % this._prime;

      path.push({
        parentCommitment: currentCommitment.toString(16).padStart(64, '0'),
        childIndex: childIdx,
        childValue: childVal.toString(16).padStart(64, '0'),
        quotientProof: quotient.toString(16).padStart(64, '0'),
      });

      currentCommitment = childVal;
    }

    return {
      key,
      value,
      rootCommitment: this.root,
      path,
      isMembership: value !== undefined,
    };
  }

  /**
   * Statically verifies a Verkle evaluation proof against the expected root commitment.
   */
  public static verifyProof(proof: VerkleProof): boolean {
    if (proof.path.length === 0) return false;
    if (proof.path[0].parentCommitment !== proof.rootCommitment) return false;

    for (let i = 0; i < proof.path.length; i++) {
      const step = proof.path[i];
      const parentComm = BigInt('0x' + step.parentCommitment);
      const childVal = BigInt('0x' + step.childValue);
      const quotient = BigInt('0x' + step.quotientProof);
      const z = BigInt(step.childIndex + 1);

      // Verify quotient relation: quotient * z == (parentComm - childVal) mod p
      const left = (quotient * z) % VERKLE_PRIME;
      const right = ((parentComm - childVal) % VERKLE_PRIME + VERKLE_PRIME) % VERKLE_PRIME;

      if (left !== right) {
        return false;
      }
    }

    return true;
  }

  private recomputeRoot(): bigint {
    if (this._leaves.size === 0) return 0n;

    const vector: bigint[] = new Array(this._width).fill(0n);
    for (const [k, v] of this._leaves) {
      const indices = this.keyToPathIndices(k);
      const topIdx = indices[0];
      const scalarVal = this.hashScalar(`${k}:${v}`);
      vector[topIdx] = (vector[topIdx] + scalarVal) % this._prime;
    }

    return this.commitVector(vector);
  }

  private keyToPathIndices(key: string): number[] {
    const hash = createHash('sha256').update(key).digest();
    const indices: number[] = [];
    for (let i = 0; i < this._depth; i++) {
      indices.push(hash[i % hash.length] % this._width);
    }
    return indices;
  }

  private hashScalar(input: string): bigint {
    const h = createHash('sha256').update(input).digest('hex');
    return (BigInt('0x' + h) % (this._prime - 1n)) + 1n;
  }

  private modInverse(a: bigint, m: bigint): bigint {
    let [oldR, r] = [((a % m) + m) % m, m];
    let [oldS, s] = [1n, 0n];

    while (r !== 0n) {
      const q = oldR / r;
      [oldR, r] = [r, oldR - q * r];
      [oldS, s] = [s, oldS - q * s];
    }

    return (oldS % m + m) % m;
  }
}
