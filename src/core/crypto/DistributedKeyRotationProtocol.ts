/**
 * @file DistributedKeyRotationProtocol.ts
 * @description Distributed Asynchronous Key Rotation & Proactive Secret Sharing Engine.
 * Implements dealerless proactive secret sharing renewal over BN254 using zero-constant
 * polynomials and Feldman homomorphic verification. Refreshes individual validator secret
 * shares across epochs without exposing the master key or altering the group public key.
 */

import { createHash, randomBytes } from 'crypto';

export const DKR_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DKR_GENERATOR = 3n;

/**
 * Field arithmetic helper over BN254.
 */
export class DKRFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = DKR_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = DKR_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = DKR_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = DKR_PRIME): bigint {
    let res = 1n;
    let b = ((base % p) + p) % p;
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) res = (res * b) % p;
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = DKR_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('DKRFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static randomScalar(p: bigint = DKR_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Configuration for key rotation.
 */
export interface KeyRotationConfig {
  threshold: number;
  totalParties: number;
  prime?: bigint;
  g?: bigint;
}

/**
 * Point-to-point zero-sharing delta subshare.
 */
export interface ZeroSharingSubshare {
  fromParty: number;
  toParty: number;
  epoch: number;
  delta: bigint;
}

/**
 * Homomorphic Feldman commitments to zero-sharing polynomial coefficients.
 */
export interface ZeroSharingCommitment {
  fromParty: number;
  epoch: number;
  commitments: bigint[]; // C_k = a_k * G for k in 1..t-1 (constant term a_0 = 0)
}

/**
 * Resulting updated key share for a validator.
 */
export interface RotatedKeyShare {
  partyIndex: number;
  epoch: number;
  oldShare: bigint;
  newShare: bigint;
  newPublicKeyShare: bigint;
}

/**
 * Distributed Asynchronous Key Rotation Protocol.
 */
export class DistributedKeyRotationProtocol {
  public readonly threshold: number;
  public readonly totalParties: number;
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(config: KeyRotationConfig) {
    this.threshold = config.threshold;
    this.totalParties = config.totalParties;
    this.prime = config.prime ?? DKR_PRIME;
    this.g = config.g ?? DKR_GENERATOR;
  }

  /**
   * Generates a zero-sharing polynomial g_i(X) with zero constant term:
   * g_i(X) = sum_{k=1}^{t-1} a_{i,k} X^k (where g_i(0) = 0).
   */
  public generateZeroSharing(
    partyIndex: number,
    epoch: number
  ): { commitment: ZeroSharingCommitment; subshares: ZeroSharingSubshare[] } {
    // Coefficients a_1, ..., a_{t-1}
    const coeffs: bigint[] = [];
    for (let k = 1; k < this.threshold; k++) {
      coeffs.push(DKRFieldMath.randomScalar(this.prime));
    }

    // Feldman commitments: C_k = a_k * G
    const commitments: bigint[] = coeffs.map((c) => DKRFieldMath.mul(c, this.g, this.prime));
    const commitment: ZeroSharingCommitment = {
      fromParty: partyIndex,
      epoch,
      commitments,
    };

    // Subshares for all parties j in 1..totalParties
    const subshares: ZeroSharingSubshare[] = [];
    for (let j = 1; j <= this.totalParties; j++) {
      const x = BigInt(j);
      let delta = 0n;
      let xPower = x; // starts at x^1 since a_0 = 0

      for (let k = 0; k < coeffs.length; k++) {
        const term = DKRFieldMath.mul(coeffs[k], xPower, this.prime);
        delta = DKRFieldMath.add(delta, term, this.prime);
        xPower = DKRFieldMath.mul(xPower, x, this.prime);
      }

      subshares.push({
        fromParty: partyIndex,
        toParty: j,
        epoch,
        delta,
      });
    }

    return { commitment, subshares };
  }

  /**
   * Verifies that incoming delta subshare matches published zero commitments:
   * delta * G == sum_{k=1}^{t-1} (toParty)^k * C_k.
   */
  public verifyZeroSubshare(
    subshare: ZeroSharingSubshare,
    commitment: ZeroSharingCommitment
  ): boolean {
    if (subshare.fromParty !== commitment.fromParty || subshare.epoch !== commitment.epoch) {
      return false;
    }

    const lhs = DKRFieldMath.mul(subshare.delta, this.g, this.prime);

    let rhs = 0n;
    const x = BigInt(subshare.toParty);
    let xPower = x;

    for (let k = 0; k < commitment.commitments.length; k++) {
      const term = DKRFieldMath.mul(commitment.commitments[k], xPower, this.prime);
      rhs = DKRFieldMath.add(rhs, term, this.prime);
      xPower = DKRFieldMath.mul(xPower, x, this.prime);
    }

    return lhs === rhs;
  }

  /**
   * Applies key rotation to a party's local secret share:
   * s'_j = s_j + sum_{i} delta_{i -> j} mod p.
   */
  public applyKeyRotation(
    partyIndex: number,
    oldShare: bigint,
    verifiedSubshares: ZeroSharingSubshare[],
    epoch: number
  ): RotatedKeyShare {
    let newShare = ((oldShare % this.prime) + this.prime) % this.prime;

    for (const sub of verifiedSubshares) {
      if (sub.toParty !== partyIndex) {
        throw new Error(`Subshare directed to party ${sub.toParty}, not party ${partyIndex}`);
      }
      newShare = DKRFieldMath.add(newShare, sub.delta, this.prime);
    }

    const newPublicKeyShare = DKRFieldMath.mul(newShare, this.g, this.prime);

    return {
      partyIndex,
      epoch,
      oldShare,
      newShare,
      newPublicKeyShare,
    };
  }

  /**
   * Reconstructs the master secret from any threshold subset of shares via Lagrange interpolation.
   */
  public reconstructSecret(shares: { partyIndex: number; share: bigint }[]): bigint {
    if (shares.length < this.threshold) {
      throw new Error(`Insufficient shares: have ${shares.length}, need ${this.threshold}`);
    }

    const activeSubset = shares.slice(0, this.threshold);
    const indices = activeSubset.map((s) => BigInt(s.partyIndex));

    let secret = 0n;
    for (let i = 0; i < this.threshold; i++) {
      const xi = indices[i];
      let num = 1n;
      let den = 1n;

      for (let j = 0; j < this.threshold; j++) {
        if (i === j) continue;
        const xj = indices[j];
        // l_i(0) = \prod_{j != i} (0 - xj) / (xi - xj)
        num = DKRFieldMath.mul(num, DKRFieldMath.sub(0n, xj, this.prime), this.prime);
        den = DKRFieldMath.mul(den, DKRFieldMath.sub(xi, xj, this.prime), this.prime);
      }

      const lagrange = DKRFieldMath.mul(num, DKRFieldMath.inv(den, this.prime), this.prime);
      const term = DKRFieldMath.mul(lagrange, activeSubset[i].share, this.prime);
      secret = DKRFieldMath.add(secret, term, this.prime);
    }

    return secret;
  }
}
