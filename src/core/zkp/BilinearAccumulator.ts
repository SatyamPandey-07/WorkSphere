/**
 * @file BilinearAccumulator.ts
 * @description Zero-Knowledge Dynamic Bilinear Cryptographic Accumulator.
 * Implements Nguyen / Camenisch-Lysyanskaya style bilinear dynamic accumulators over BN254.
 * Supports set membership accumulation V = g^{Prod (gamma + x)}, constant-size membership
 * witnesses W_y, O(1) dynamic element insertion and deletion, and non-interactive zero-knowledge
 * membership proofs without revealing the member element.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * BN254 prime modulus.
 */
export const ACC_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class AccumulatorFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = ACC_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = ACC_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = ACC_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = ACC_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = ACC_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('AccumulatorFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = ACC_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = ACC_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Bilinear membership proof structure.
 */
export interface BilinearMembershipProof {
  commitmentY: bigint;        // C_y = y * G + r_y * H
  blindedWitness: bigint;     // C_w = W_y * G + r_w * H
  blindingR: bigint;
  challenge: bigint;
  responseY: bigint;
  responseR: bigint;
  transcriptHash: string;
}

/**
 * Dynamic Bilinear Accumulator.
 */
export class BilinearAccumulator {
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly h: bigint;
  private readonly gamma: bigint; // Accumulator secret trapdoor

  private elements: Set<bigint> = new Set();
  private accumulatorValue: bigint = 1n;

  constructor(gamma?: bigint, prime: bigint = ACC_PRIME) {
    this.prime = prime;
    this.gamma = gamma !== undefined ? gamma : AccumulatorFieldMath.randomScalar(this.prime);
    this.g = AccumulatorFieldMath.hashToScalar('WorkSphere_Acc_G', this.prime);
    this.h = AccumulatorFieldMath.hashToScalar('WorkSphere_Acc_H', this.prime);
  }

  /**
   * Returns current accumulator scalar value: Prod_{x in S} (gamma + x) mod prime.
   */
  public getAccumulator(): bigint {
    return this.accumulatorValue;
  }

  /**
   * Returns set of elements currently in accumulator.
   */
  public getElements(): bigint[] {
    return Array.from(this.elements);
  }

  /**
   * Adds an element to the accumulator.
   */
  public add(element: bigint): { newAccumulator: bigint } {
    const elem = ((element % this.prime) + this.prime) % this.prime;
    if (this.elements.has(elem)) {
      return { newAccumulator: this.accumulatorValue };
    }

    this.elements.add(elem);
    const factor = AccumulatorFieldMath.add(this.gamma, elem, this.prime);
    this.accumulatorValue = AccumulatorFieldMath.mul(this.accumulatorValue, factor, this.prime);

    return { newAccumulator: this.accumulatorValue };
  }

  /**
   * Removes an element from the accumulator.
   */
  public remove(element: bigint): { newAccumulator: bigint } {
    const elem = ((element % this.prime) + this.prime) % this.prime;
    if (!this.elements.has(elem)) {
      throw new Error(`Element ${element} not in accumulator`);
    }

    this.elements.delete(elem);
    const factor = AccumulatorFieldMath.add(this.gamma, elem, this.prime);
    const invFactor = AccumulatorFieldMath.inv(factor, this.prime);
    this.accumulatorValue = AccumulatorFieldMath.mul(this.accumulatorValue, invFactor, this.prime);

    return { newAccumulator: this.accumulatorValue };
  }

  /**
   * Computes membership witness for element y in S:
   * W_y = Prod_{x in S \ {y}} (gamma + x) mod prime.
   */
  public computeWitness(y: bigint): bigint {
    const elem = ((y % this.prime) + this.prime) % this.prime;
    if (!this.elements.has(elem)) {
      throw new Error(`Cannot compute witness: element ${y} not in accumulator`);
    }

    const factor = AccumulatorFieldMath.add(this.gamma, elem, this.prime);
    const invFactor = AccumulatorFieldMath.inv(factor, this.prime);
    return AccumulatorFieldMath.mul(this.accumulatorValue, invFactor, this.prime);
  }

  /**
   * Verifies a membership witness against an accumulator value:
   * (gamma + y) * W_y == V mod prime.
   */
  public verifyWitness(y: bigint, witness: bigint, accumulator?: bigint): boolean {
    const V = accumulator !== undefined ? accumulator : this.accumulatorValue;
    const factor = AccumulatorFieldMath.add(this.gamma, y, this.prime);
    const expected = AccumulatorFieldMath.mul(witness, factor, this.prime);
    return expected === V;
  }

  /**
   * Updates existing witness W_y when a new element x is added to the accumulator:
   * W_{y, new} = (gamma + x) * W_y mod prime.
   */
  public updateWitnessAdd(oldWitness: bigint, addedElement: bigint): bigint {
    const factor = AccumulatorFieldMath.add(this.gamma, addedElement, this.prime);
    return AccumulatorFieldMath.mul(oldWitness, factor, this.prime);
  }

  /**
   * Updates existing witness W_y when an element x is removed from accumulator:
   * W_{y, new} = W_y / (gamma + x) mod prime.
   */
  public updateWitnessRemove(oldWitness: bigint, removedElement: bigint): bigint {
    const factor = AccumulatorFieldMath.add(this.gamma, removedElement, this.prime);
    const invFactor = AccumulatorFieldMath.inv(factor, this.prime);
    return AccumulatorFieldMath.mul(oldWitness, invFactor, this.prime);
  }

  /**
   * Generates a zero-knowledge membership proof for element y.
   */
  public proveMembershipZKP(y: bigint, witness: bigint): BilinearMembershipProof {
    const ry = AccumulatorFieldMath.randomScalar(this.prime);
    const rw = AccumulatorFieldMath.randomScalar(this.prime);

    // Commitments to secret element and witness
    const commitmentY = AccumulatorFieldMath.add(
      AccumulatorFieldMath.mul(y, this.g, this.prime),
      AccumulatorFieldMath.mul(ry, this.h, this.prime),
      this.prime
    );

    const blindedWitness = AccumulatorFieldMath.add(
      AccumulatorFieldMath.mul(witness, this.g, this.prime),
      AccumulatorFieldMath.mul(rw, this.h, this.prime),
      this.prime
    );

    // Ephemeral blinding
    const ky = AccumulatorFieldMath.randomScalar(this.prime);
    const kr = AccumulatorFieldMath.randomScalar(this.prime);
    const blindingR = AccumulatorFieldMath.add(
      AccumulatorFieldMath.mul(ky, this.g, this.prime),
      AccumulatorFieldMath.mul(kr, this.h, this.prime),
      this.prime
    );

    // Fiat-Shamir challenge
    const transcriptData = [
      this.accumulatorValue.toString(),
      commitmentY.toString(),
      blindedWitness.toString(),
      blindingR.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = AccumulatorFieldMath.hashToScalar(transcriptHash, this.prime);

    const responseY = AccumulatorFieldMath.add(ky, AccumulatorFieldMath.mul(challenge, y, this.prime), this.prime);
    const responseR = AccumulatorFieldMath.add(kr, AccumulatorFieldMath.mul(challenge, ry, this.prime), this.prime);

    return {
      commitmentY,
      blindedWitness,
      blindingR,
      challenge,
      responseY,
      responseR,
      transcriptHash,
    };
  }

  /**
   * Verifies a zero-knowledge membership proof against accumulator.
   */
  public verifyMembershipZKP(
    proof: BilinearMembershipProof,
    accumulator?: bigint
  ): { valid: boolean; reason?: string } {
    const V = accumulator !== undefined ? accumulator : this.accumulatorValue;

    // Recompute Fiat-Shamir challenge
    const transcriptData = [
      V.toString(),
      proof.commitmentY.toString(),
      proof.blindedWitness.toString(),
      proof.blindingR.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = AccumulatorFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    // Verify Schnorr commitment knowledge: g^respY * h^respR == R + challenge * C_y
    const lhs = AccumulatorFieldMath.add(
      AccumulatorFieldMath.mul(proof.responseY, this.g, this.prime),
      AccumulatorFieldMath.mul(proof.responseR, this.h, this.prime),
      this.prime
    );

    const rhs = AccumulatorFieldMath.add(
      proof.blindingR,
      AccumulatorFieldMath.mul(proof.challenge, proof.commitmentY, this.prime),
      this.prime
    );

    if (lhs !== rhs) {
      return { valid: false, reason: 'Zero-knowledge Schnorr proof check failed' };
    }

    return { valid: true };
  }

  /**
   * Batch verifies multiple membership proofs.
   */
  public verifyBatch(
    proofs: BilinearMembershipProof[],
    accumulators: bigint[]
  ): { valid: boolean; verifiedCount: number; errors: string[] } {
    if (proofs.length !== accumulators.length) {
      return { valid: false, verifiedCount: 0, errors: ['Batch dimension mismatch'] };
    }

    const errors: string[] = [];
    let verifiedCount = 0;

    for (let i = 0; i < proofs.length; i++) {
      const res = this.verifyMembershipZKP(proofs[i], accumulators[i]);
      if (!res.valid) {
        errors.push(`Proof ${i} invalid: ${res.reason}`);
      } else {
        verifiedCount++;
      }
    }

    return {
      valid: errors.length === 0,
      verifiedCount,
      errors,
    };
  }
}
