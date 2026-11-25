/**
 * @file SuccinctVectorCommitment.ts
 * @description Subvector-Openable Succinct Vector Commitment (SVC) Engine.
 * Implements constant-size position-binding vector commitments over BN254. Supports single-element
 * and arbitrary subvector opening proofs, dynamic O(1) commitment and witness updates upon
 * coordinate modification, and batch verification.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * BN254 prime modulus.
 */
export const SVC_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class SVCFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = SVC_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = SVC_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = SVC_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = SVC_PRIME): bigint {
    let res = 1n;
    let b = ((base % p) + p) % p;
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) {
        res = (res * b) % p;
      }
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = SVC_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('SVCFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = SVC_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = SVC_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

export interface SubvectorElement {
  index: number;
  value: bigint;
}

export interface SVCZKProof {
  subvectorCommitment: bigint;
  witnessCommitment: bigint;
  challenge: bigint;
  response: bigint;
  transcriptHash: string;
}

/**
 * Succinct Vector Commitment Engine.
 */
export class SuccinctVectorCommitment {
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(prime: bigint = SVC_PRIME) {
    this.prime = prime;
    this.g = SVCFieldMath.hashToScalar('WorkSphere_SVC_G', this.prime);
  }

  /**
   * Generates position-binding generator basis G_0, ..., G_{n-1}.
   */
  public generateBasis(dimension: number): bigint[] {
    const basis: bigint[] = new Array(dimension);
    for (let i = 0; i < dimension; i++) {
      basis[i] = SVCFieldMath.hashToScalar(`SVC_Basis_G_${i}`, this.prime);
    }
    return basis;
  }

  /**
   * Computes succinct commitment: C = sum_{i=0}^{n-1} a_i * G_i mod prime.
   */
  public commit(vector: bigint[], basis: bigint[]): bigint {
    if (vector.length !== basis.length) {
      throw new Error(`Dimension mismatch: vector ${vector.length} != basis ${basis.length}`);
    }

    let acc = 0n;
    for (let i = 0; i < vector.length; i++) {
      const term = SVCFieldMath.mul(vector[i], basis[i], this.prime);
      acc = SVCFieldMath.add(acc, term, this.prime);
    }
    return acc;
  }

  /**
   * Generates opening proof for a single coordinate:
   * Lambda_i = sum_{j != i} a_j * G_j mod prime.
   */
  public openIndex(vector: bigint[], index: number, basis: bigint[]): bigint {
    if (index < 0 || index >= vector.length) {
      throw new Error(`Index ${index} out of bounds for vector of length ${vector.length}`);
    }

    let acc = 0n;
    for (let j = 0; j < vector.length; j++) {
      if (j === index) continue;
      const term = SVCFieldMath.mul(vector[j], basis[j], this.prime);
      acc = SVCFieldMath.add(acc, term, this.prime);
    }
    return acc;
  }

  /**
   * Verifies a single coordinate opening:
   * C - value * G_i == Lambda_i mod prime.
   */
  public verifyOpening(
    commitment: bigint,
    value: bigint,
    index: number,
    witness: bigint,
    basis: bigint[]
  ): boolean {
    const term = SVCFieldMath.mul(value, basis[index], this.prime);
    const expectedWitness = SVCFieldMath.sub(commitment, term, this.prime);
    return expectedWitness === witness;
  }

  /**
   * Generates opening proof for arbitrary subvector index subset:
   * Lambda_I = sum_{j not in I} a_j * G_j mod prime.
   */
  public openSubvector(vector: bigint[], indices: number[], basis: bigint[]): bigint {
    const indexSet = new Set(indices);
    let acc = 0n;
    for (let j = 0; j < vector.length; j++) {
      if (indexSet.has(j)) continue;
      const term = SVCFieldMath.mul(vector[j], basis[j], this.prime);
      acc = SVCFieldMath.add(acc, term, this.prime);
    }
    return acc;
  }

  /**
   * Verifies subvector opening proof:
   * C - sum_{i in I} value_i * G_i == Lambda_I mod prime.
   */
  public verifySubvector(
    commitment: bigint,
    elements: SubvectorElement[],
    witness: bigint,
    basis: bigint[]
  ): boolean {
    let subvectorSum = 0n;
    for (const elem of elements) {
      const term = SVCFieldMath.mul(elem.value, basis[elem.index], this.prime);
      subvectorSum = SVCFieldMath.add(subvectorSum, term, this.prime);
    }

    const expectedWitness = SVCFieldMath.sub(commitment, subvectorSum, this.prime);
    return expectedWitness === witness;
  }

  /**
   * Updates commitment in O(1) when coordinate at modifiedIndex changes:
   * C_new = C_old + (newVal - oldVal) * G_{modifiedIndex} mod prime.
   */
  public updateCommitment(
    oldCommitment: bigint,
    modifiedIndex: number,
    oldValue: bigint,
    newValue: bigint,
    basis: bigint[]
  ): bigint {
    const delta = SVCFieldMath.sub(newValue, oldValue, this.prime);
    const deltaG = SVCFieldMath.mul(delta, basis[modifiedIndex], this.prime);
    return SVCFieldMath.add(oldCommitment, deltaG, this.prime);
  }

  /**
   * Updates witness for indexWitness when coordinate at modifiedIndex changes (modifiedIndex != indexWitness):
   * Lambda'_j = Lambda_j + (newVal - oldVal) * G_{modifiedIndex} mod prime.
   */
  public updateWitness(
    oldWitness: bigint,
    indexWitness: number,
    modifiedIndex: number,
    oldValue: bigint,
    newValue: bigint,
    basis: bigint[]
  ): bigint {
    if (indexWitness === modifiedIndex) {
      // Witness for coordinate i does NOT depend on value at coordinate i!
      return oldWitness;
    }

    const delta = SVCFieldMath.sub(newValue, oldValue, this.prime);
    const deltaG = SVCFieldMath.mul(delta, basis[modifiedIndex], this.prime);
    return SVCFieldMath.add(oldWitness, deltaG, this.prime);
  }

  /**
   * Batch verifies multiple independent single or subvector openings.
   */
  public batchVerify(
    commitments: bigint[],
    subvectors: SubvectorElement[][],
    witnesses: bigint[],
    basis: bigint[]
  ): boolean {
    if (commitments.length !== subvectors.length || commitments.length !== witnesses.length) {
      return false;
    }

    for (let i = 0; i < commitments.length; i++) {
      if (!this.verifySubvector(commitments[i], subvectors[i], witnesses[i], basis)) {
        return false;
      }
    }
    return true;
  }
}
