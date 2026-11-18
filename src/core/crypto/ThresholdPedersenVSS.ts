/**
 * @file ThresholdPedersenVSS.ts
 * @description Verifiable Secret Sharing (VSS) with Pedersen-Feldman Commitments.
 * Implements information-theoretically hiding (t, n) threshold verifiable secret sharing over BN254.
 * A dealer splits a secret s using random polynomials P(x) and Q(x), commits to polynomial
 * coefficients via Pedersen commitments C_k = a_k * G + b_k * H mod p, and participants
 * verify their private shares (s_i, r_i) against commitments without revealing the secret.
 * Any threshold t of n honest participants can reconstruct the secret via Lagrange interpolation.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Alt-bn128 prime modulus.
 */
export const VSS_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Arithmetic helper functions for VSS scalar field and exponentiation.
 */
export class VSSFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = VSS_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = VSS_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = VSS_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = VSS_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = VSS_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('VSSFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = VSS_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = VSS_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * A participant's verifiable share.
 */
export interface VSSShare {
  index: number;      // 1-based participant index
  shareS: bigint;     // Secret share P(i)
  shareR: bigint;     // Blinding share Q(i)
}

/**
 * Result of dealing a secret.
 */
export interface VSSDealResult {
  commitments: bigint[]; // C_k = a_k * G + b_k * H mod prime
  shares: VSSShare[];
  threshold: number;
  totalShares: number;
}

/**
 * Threshold Pedersen Verifiable Secret Sharing Engine.
 */
export class ThresholdPedersenVSS {
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly h: bigint;

  constructor(prime: bigint = VSS_PRIME) {
    this.prime = prime;
    this.g = VSSFieldMath.hashToScalar('WorkSphere_VSS_G', this.prime);
    this.h = VSSFieldMath.hashToScalar('WorkSphere_VSS_H', this.prime);
  }

  /**
   * Generates a Pedersen commitment: C = a * G + b * H mod prime.
   */
  public commit(a: bigint, b: bigint): bigint {
    const ag = VSSFieldMath.mul(a, this.g, this.prime);
    const bh = VSSFieldMath.mul(b, this.h, this.prime);
    return VSSFieldMath.add(ag, bh, this.prime);
  }

  /**
   * Evaluates a polynomial sum_{k=0}^{t-1} coeff[k] * x^k mod prime.
   */
  public evaluatePolynomial(coeffs: bigint[], x: bigint): bigint {
    let result = 0n;
    let power = 1n;
    for (let k = 0; k < coeffs.length; k++) {
      const term = VSSFieldMath.mul(coeffs[k], power, this.prime);
      result = VSSFieldMath.add(result, term, this.prime);
      power = VSSFieldMath.mul(power, x, this.prime);
    }
    return result;
  }

  /**
   * Deals a secret among totalShares participants with threshold t.
   */
  public deal(
    secret: bigint,
    threshold: number,
    totalShares: number,
    blinding?: bigint
  ): VSSDealResult {
    if (threshold < 1 || threshold > totalShares) {
      throw new Error(`Invalid threshold ${threshold} for ${totalShares} shares`);
    }

    const s = ((secret % this.prime) + this.prime) % this.prime;
    const r = blinding !== undefined ? ((blinding % this.prime) + this.prime) % this.prime : VSSFieldMath.randomScalar(this.prime);

    // Polynomial coefficients: a_0 = s, b_0 = r
    const polyA: bigint[] = [s];
    const polyB: bigint[] = [r];

    for (let k = 1; k < threshold; k++) {
      polyA.push(VSSFieldMath.randomScalar(this.prime));
      polyB.push(VSSFieldMath.randomScalar(this.prime));
    }

    // Commitments to coefficients: C_k = a_k * G + b_k * H mod prime
    const commitments: bigint[] = new Array(threshold);
    for (let k = 0; k < threshold; k++) {
      commitments[k] = this.commit(polyA[k], polyB[k]);
    }

    // Generate shares for each participant i = 1, ..., n
    const shares: VSSShare[] = new Array(totalShares);
    for (let i = 1; i <= totalShares; i++) {
      const idx = BigInt(i);
      shares[i - 1] = {
        index: i,
        shareS: this.evaluatePolynomial(polyA, idx),
        shareR: this.evaluatePolynomial(polyB, idx),
      };
    }

    return {
      commitments,
      shares,
      threshold,
      totalShares,
    };
  }

  /**
   * Verifies a participant's share against the public coefficient commitments:
   * s_i * G + r_i * H == sum_{k=0}^{t-1} i^k * C_k mod prime.
   */
  public verifyShare(share: VSSShare, commitments: bigint[]): boolean {
    const lhs = this.commit(share.shareS, share.shareR);

    let rhs = 0n;
    let power = 1n;
    const idx = BigInt(share.index);

    for (let k = 0; k < commitments.length; k++) {
      const term = VSSFieldMath.mul(commitments[k], power, this.prime);
      rhs = VSSFieldMath.add(rhs, term, this.prime);
      power = VSSFieldMath.mul(power, idx, this.prime);
    }

    return lhs === rhs;
  }

  /**
   * Reconstructs the secret and blinding using Lagrange interpolation from any t shares.
   */
  public reconstructSecret(
    shares: VSSShare[],
    threshold: number
  ): { secret: bigint; blinding: bigint } {
    if (shares.length < threshold) {
      throw new Error(`Insufficient shares: got ${shares.length}, threshold requires ${threshold}`);
    }

    const activeShares = shares.slice(0, threshold);
    let secret = 0n;
    let blinding = 0n;

    for (let i = 0; i < threshold; i++) {
      const xi = BigInt(activeShares[i].index);
      let num = 1n;
      let den = 1n;

      for (let j = 0; j < threshold; j++) {
        if (i === j) continue;
        const xj = BigInt(activeShares[j].index);
        num = VSSFieldMath.mul(num, VSSFieldMath.sub(0n, xj, this.prime), this.prime);
        const diff = VSSFieldMath.sub(xi, xj, this.prime);
        den = VSSFieldMath.mul(den, diff, this.prime);
      }

      const lambda_i = VSSFieldMath.mul(num, VSSFieldMath.inv(den, this.prime), this.prime);

      const sTerm = VSSFieldMath.mul(lambda_i, activeShares[i].shareS, this.prime);
      const rTerm = VSSFieldMath.mul(lambda_i, activeShares[i].shareR, this.prime);

      secret = VSSFieldMath.add(secret, sTerm, this.prime);
      blinding = VSSFieldMath.add(blinding, rTerm, this.prime);
    }

    return { secret, blinding };
  }

  /**
   * Batch verifies all shares against commitments.
   */
  public batchVerifyShares(shares: VSSShare[], commitments: bigint[]): boolean {
    for (const share of shares) {
      if (!this.verifyShare(share, commitments)) {
        return false;
      }
    }
    return true;
  }
}
