/**
 * @file ShareConversionProtocol.ts
 * @description Verifiable Shamir-to-Additive Secret Share Conversion Protocol.
 * Converts (t, n) Shamir threshold shares into (t, t) additive shares over a signing
 * coalition for Threshold ECDSA / MPC protocols (GG20, CGGMP21, FROST) over BN254.
 * Supports Feldman share verification, non-interactive Lagrange conversion, zero-sum
 * additive re-masking, and homomorphic public key preservation checks.
 */

import { randomBytes } from 'crypto';

export const SHARE_CONV_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const SHARE_CONV_GENERATOR = 3n;

/**
 * Field arithmetic utilities over BN254.
 */
export class ShareConvFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = SHARE_CONV_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = SHARE_CONV_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = SHARE_CONV_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = SHARE_CONV_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = SHARE_CONV_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('ShareConvFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static randomScalar(p: bigint = SHARE_CONV_PRIME): bigint {
    const b = randomBytes(32);
    const val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Individual (t, n) Shamir secret share.
 */
export interface ShamirShare {
  partyIndex: number;
  value: bigint;
  publicShare: bigint;
}

/**
 * Converted (t, t) additive secret share over a signing coalition.
 */
export interface AdditiveShare {
  partyIndex: number;
  value: bigint;
  publicCommitment: bigint;
  lagrangeWeight: bigint;
}

/**
 * Result of Shamir splitting with Feldman commitments.
 */
export interface ShamirSplitResult {
  masterPublicKey: bigint;
  commitments: bigint[];
  shares: ShamirShare[];
  threshold: number;
}

/**
 * Result of verifying converted additive commitments.
 */
export interface ConversionVerificationResult {
  isValid: boolean;
  reason?: string;
  reconstructedPublicKey: bigint;
}

/**
 * Verifiable Shamir-to-Additive Share Conversion Engine.
 */
export class ShareConversionProtocol {
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(prime: bigint = SHARE_CONV_PRIME, g: bigint = SHARE_CONV_GENERATOR) {
    this.prime = prime;
    this.g = g;
  }

  /**
   * Splits a secret into (threshold, totalParties) Shamir shares with Feldman commitments.
   */
  public splitShamir(secret: bigint, threshold: number, totalParties: number): ShamirSplitResult {
    if (threshold < 1 || threshold > totalParties) {
      throw new Error(`Invalid threshold (${threshold}) for totalParties (${totalParties})`);
    }

    const normSecret = ((secret % this.prime) + this.prime) % this.prime;
    const coeffs: bigint[] = [normSecret];
    for (let k = 1; k < threshold; k++) {
      coeffs.push(ShareConvFieldMath.randomScalar(this.prime));
    }

    const commitments = coeffs.map((c) => ShareConvFieldMath.mul(c, this.g, this.prime));
    const shares: ShamirShare[] = [];

    for (let i = 1; i <= totalParties; i++) {
      const x = BigInt(i);
      let y = 0n;
      let xPow = 1n;
      for (let k = 0; k < coeffs.length; k++) {
        y = ShareConvFieldMath.add(y, ShareConvFieldMath.mul(coeffs[k], xPow, this.prime), this.prime);
        xPow = ShareConvFieldMath.mul(xPow, x, this.prime);
      }

      shares.push({
        partyIndex: i,
        value: y,
        publicShare: ShareConvFieldMath.mul(y, this.g, this.prime),
      });
    }

    return {
      masterPublicKey: commitments[0],
      commitments,
      shares,
      threshold,
    };
  }

  /**
   * Verifies a Shamir share against Feldman commitments.
   */
  public verifyShamirShare(share: ShamirShare, commitments: bigint[]): boolean {
    const lhs = ShareConvFieldMath.mul(share.value, this.g, this.prime);
    if (lhs !== share.publicShare) return false;

    let rhs = 0n;
    const x = BigInt(share.partyIndex);
    let xPow = 1n;

    for (let k = 0; k < commitments.length; k++) {
      rhs = ShareConvFieldMath.add(
        rhs,
        ShareConvFieldMath.mul(commitments[k], xPow, this.prime),
        this.prime
      );
      xPow = ShareConvFieldMath.mul(xPow, x, this.prime);
    }

    return lhs === rhs;
  }

  /**
   * Computes Lagrange coefficients at 0 for a given signing subset of party indices.
   */
  public computeLagrangeWeights(partyIndices: number[]): Map<number, bigint> {
    const weights = new Map<number, bigint>();
    const xs = partyIndices.map((idx) => BigInt(idx));

    for (let i = 0; i < xs.length; i++) {
      let num = 1n;
      let den = 1n;
      for (let j = 0; j < xs.length; j++) {
        if (i === j) continue;
        num = ShareConvFieldMath.mul(num, ShareConvFieldMath.sub(0n, xs[j], this.prime), this.prime);
        den = ShareConvFieldMath.mul(den, ShareConvFieldMath.sub(xs[i], xs[j], this.prime), this.prime);
      }
      weights.set(partyIndices[i], ShareConvFieldMath.mul(num, ShareConvFieldMath.inv(den, this.prime), this.prime));
    }

    return weights;
  }

  /**
   * Converts a threshold subset of Shamir shares into (t, t) additive shares non-interactively.
   */
  public convertShamirToAdditive(subsetShares: ShamirShare[]): AdditiveShare[] {
    if (subsetShares.length === 0) {
      throw new Error('Cannot convert empty share subset');
    }

    const indices = subsetShares.map((s) => s.partyIndex);
    const uniqueIndices = new Set(indices);
    if (uniqueIndices.size !== indices.length) {
      throw new Error('Duplicate party indices in signing subset');
    }

    const weights = this.computeLagrangeWeights(indices);
    return subsetShares.map((s) => {
      const lambda = weights.get(s.partyIndex)!;
      const additiveVal = ShareConvFieldMath.mul(lambda, s.value, this.prime);
      return {
        partyIndex: s.partyIndex,
        value: additiveVal,
        publicCommitment: ShareConvFieldMath.mul(additiveVal, this.g, this.prime),
        lagrangeWeight: lambda,
      };
    });
  }

  /**
   * Applies zero-sum random re-masking to additive shares while preserving the sum S.
   */
  public remaskAdditiveShares(shares: AdditiveShare[]): AdditiveShare[] {
    if (shares.length < 2) {
      return shares.map((s) => ({ ...s }));
    }

    const offsets: bigint[] = [];
    let runningSum = 0n;

    for (let i = 0; i < shares.length - 1; i++) {
      const r = ShareConvFieldMath.randomScalar(this.prime);
      offsets.push(r);
      runningSum = ShareConvFieldMath.add(runningSum, r, this.prime);
    }

    // Last offset balances the sum to 0 mod p
    const balancingOffset = ShareConvFieldMath.sub(0n, runningSum, this.prime);
    offsets.push(balancingOffset);

    return shares.map((s, idx) => {
      const remaskedVal = ShareConvFieldMath.add(s.value, offsets[idx], this.prime);
      return {
        partyIndex: s.partyIndex,
        value: remaskedVal,
        publicCommitment: ShareConvFieldMath.mul(remaskedVal, this.g, this.prime),
        lagrangeWeight: s.lagrangeWeight,
      };
    });
  }

  /**
   * Verifies that additive share commitments sum to the master group public key.
   */
  public verifyAdditiveCommitments(
    shares: AdditiveShare[],
    masterPublicKey: bigint
  ): ConversionVerificationResult {
    let aggPubKey = 0n;

    for (const s of shares) {
      const expectedComm = ShareConvFieldMath.mul(s.value, this.g, this.prime);
      if (expectedComm !== s.publicCommitment) {
        return {
          isValid: false,
          reason: `Additive share commitment mismatch for party ${s.partyIndex}`,
          reconstructedPublicKey: 0n,
        };
      }
      aggPubKey = ShareConvFieldMath.add(aggPubKey, s.publicCommitment, this.prime);
    }

    if (aggPubKey !== masterPublicKey) {
      return {
        isValid: false,
        reason: 'Sum of additive public commitments does not equal master public key',
        reconstructedPublicKey: aggPubKey,
      };
    }

    return {
      isValid: true,
      reconstructedPublicKey: aggPubKey,
    };
  }

  /**
   * Reconstructs the master secret from (t, t) additive shares via simple modular addition.
   */
  public reconstructFromAdditive(shares: AdditiveShare[]): bigint {
    let sum = 0n;
    for (const s of shares) {
      sum = ShareConvFieldMath.add(sum, s.value, this.prime);
    }
    return sum;
  }
}
