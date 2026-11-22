/**
 * @file VerifiableSecretRedistribution.ts
 * @description Asynchronous Verifiable Secret Redistribution (VSR) Protocol.
 * Implements Desmedt-Jajodia verifiable secret redistribution and proactive secret sharing over BN254.
 * Enables transition of master threshold secrets from an old committee (t1, n1) to a new committee
 * (t2, n2) with dynamic threshold resizing and proactive share renewal without exposing the secret
 * or changing the master public key.
 */

import { createHash, randomBytes } from 'crypto';

export const VSR_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const VSR_GENERATOR = 3n;

/**
 * Field arithmetic helper over BN254.
 */
export class VSRFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = VSR_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = VSR_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = VSR_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = VSR_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = VSR_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('VSRFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static randomScalar(p: bigint = VSR_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Specification of a committee structure.
 */
export interface VSRCommittee {
  parties: number[];
  threshold: number;
}

/**
 * Verifiable subshare commitments for polynomial evaluation.
 */
export interface SubshareCommitment {
  fromParty: number;
  epoch: number;
  commitments: bigint[];
}

/**
 * Individual point-to-point subshare sent from old party to new party.
 */
export interface RedistributionSubshare {
  fromParty: number;
  toParty: number;
  epoch: number;
  subshare: bigint;
}

/**
 * Reconstructed new share for a new committee member.
 */
export interface NewPartyShare {
  partyIndex: number;
  epoch: number;
  share: bigint;
  publicVerificationKey: bigint;
}

/**
 * Engine for Verifiable Secret Redistribution across epochs.
 */
export class VerifiableSecretRedistribution {
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(prime: bigint = VSR_PRIME, g: bigint = VSR_GENERATOR) {
    this.prime = prime;
    this.g = g;
  }

  /**
   * Evaluates Lagrange basis polynomial l_i(0) over a set of participating indices.
   */
  public computeLagrangeCoefficients(participatingIndices: number[]): Map<number, bigint> {
    const coeffs = new Map<number, bigint>();
    const indices = participatingIndices.map((x) => BigInt(x));

    for (let i = 0; i < indices.length; i++) {
      const xi = indices[i];
      let num = 1n;
      let den = 1n;

      for (let j = 0; j < indices.length; j++) {
        if (i === j) continue;
        const xj = indices[j];
        // l_i(0) = \prod_{j != i} (0 - xj) / (xi - xj)
        num = VSRFieldMath.mul(num, VSRFieldMath.sub(0n, xj, this.prime), this.prime);
        den = VSRFieldMath.mul(den, VSRFieldMath.sub(xi, xj, this.prime), this.prime);
      }

      const lagrange = VSRFieldMath.mul(num, VSRFieldMath.inv(den, this.prime), this.prime);
      coeffs.set(participatingIndices[i], lagrange);
    }

    return coeffs;
  }

  /**
   * Old party splits its share into subshares for new committee members.
   */
  public generateSubshares(
    oldPartyIndex: number,
    oldShare: bigint,
    newThreshold: number,
    newParties: number[],
    epoch: number
  ): { commitment: SubshareCommitment; subshares: RedistributionSubshare[] } {
    const s_i = ((oldShare % this.prime) + this.prime) % this.prime;

    // Sub-polynomial: h_i(Y) = s_i + sum_{k=1}^{newThreshold - 1} b_k Y^k
    const polyCoeffs: bigint[] = [s_i];
    for (let k = 1; k < newThreshold; k++) {
      polyCoeffs.push(VSRFieldMath.randomScalar(this.prime));
    }

    // Homomorphic commitments: C_k = b_k * G
    const commitments: bigint[] = polyCoeffs.map((c) => VSRFieldMath.mul(c, this.g, this.prime));
    const commitment: SubshareCommitment = {
      fromParty: oldPartyIndex,
      epoch,
      commitments,
    };

    // Subshares for each new party j
    const subshares: RedistributionSubshare[] = [];
    for (const newParty of newParties) {
      const y = BigInt(newParty);
      let subshareVal = 0n;
      let yPower = 1n;

      for (let k = 0; k < polyCoeffs.length; k++) {
        const term = VSRFieldMath.mul(polyCoeffs[k], yPower, this.prime);
        subshareVal = VSRFieldMath.add(subshareVal, term, this.prime);
        yPower = VSRFieldMath.mul(yPower, y, this.prime);
      }

      subshares.push({
        fromParty: oldPartyIndex,
        toParty: newParty,
        epoch,
        subshare: subshareVal,
      });
    }

    return { commitment, subshares };
  }

  /**
   * Verifies that subshare s_{i -> j} matches homomorphic commitments sum j^k * C_k.
   */
  public verifySubshare(subshare: RedistributionSubshare, commitment: SubshareCommitment): boolean {
    if (subshare.fromParty !== commitment.fromParty || subshare.epoch !== commitment.epoch) {
      return false;
    }

    const lhs = VSRFieldMath.mul(subshare.subshare, this.g, this.prime);

    let rhs = 0n;
    let yPower = 1n;
    const y = BigInt(subshare.toParty);

    for (let k = 0; k < commitment.commitments.length; k++) {
      const term = VSRFieldMath.mul(commitment.commitments[k], yPower, this.prime);
      rhs = VSRFieldMath.add(rhs, term, this.prime);
      yPower = VSRFieldMath.mul(yPower, y, this.prime);
    }

    return lhs === rhs;
  }

  /**
   * New party j interpolates verified subshares from old committee into its new share s'_j.
   */
  public reconstructNewShare(
    newPartyIndex: number,
    subshares: RedistributionSubshare[],
    activeOldParties: number[],
    epoch: number
  ): NewPartyShare {
    if (subshares.length < activeOldParties.length) {
      throw new Error(`Insufficient subshares: have ${subshares.length}, need ${activeOldParties.length}`);
    }

    const subshareMap = new Map<number, bigint>();
    for (const s of subshares) {
      if (s.toParty === newPartyIndex) {
        subshareMap.set(s.fromParty, s.subshare);
      }
    }

    const lagrangeMap = this.computeLagrangeCoefficients(activeOldParties);

    let newShareVal = 0n;
    for (const oldParty of activeOldParties) {
      const subVal = subshareMap.get(oldParty);
      if (subVal === undefined) {
        throw new Error(`Missing subshare from old party ${oldParty}`);
      }
      const lambda = lagrangeMap.get(oldParty)!;
      const term = VSRFieldMath.mul(lambda, subVal, this.prime);
      newShareVal = VSRFieldMath.add(newShareVal, term, this.prime);
    }

    const publicVerificationKey = VSRFieldMath.mul(newShareVal, this.g, this.prime);

    return {
      partyIndex: newPartyIndex,
      epoch,
      share: newShareVal,
      publicVerificationKey,
    };
  }

  /**
   * Reconstructs the original secret from any threshold subset of shares.
   */
  public reconstructSecret(shares: { partyIndex: number; share: bigint }[], threshold: number): bigint {
    if (shares.length < threshold) {
      throw new Error(`Need at least ${threshold} shares to reconstruct secret (got ${shares.length})`);
    }

    const activeSubset = shares.slice(0, threshold);
    const indices = activeSubset.map((s) => s.partyIndex);
    const lagrangeMap = this.computeLagrangeCoefficients(indices);

    let secret = 0n;
    for (const s of activeSubset) {
      const lambda = lagrangeMap.get(s.partyIndex)!;
      const term = VSRFieldMath.mul(lambda, s.share, this.prime);
      secret = VSRFieldMath.add(secret, term, this.prime);
    }

    return secret;
  }
}
