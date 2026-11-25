/**
 * @file ThresholdECDSAPresignatureVerifier.ts
 * @description Distributed (t, n) threshold presignature share & Feldman-VSS
 * verifier over a 128-bit safe-prime multiplicative subgroup (P = 2Q + 1).
 *
 * Implements:
 * - Feldman Verifiable Secret Sharing (VSS) polynomial commitments C_j = g^{a_j} mod P
 * - Individual share verification g^{s_i} == Prod(C_j^{i^j}) mod P
 * - Lagrange interpolation coefficients over Z_Q for any qualified t-subset
 * - Multiplicative presignature nonce-masking share proofs (Schnorr PoK + Feldman link)
 * - Partial signature generation, share verification, and threshold signature reconstruction
 */

import { createHash, randomBytes } from 'crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

function modNorm(x: bigint, mod: bigint): bigint {
  const r = x % mod;
  return r >= 0n ? r : r + mod;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  if (e < 0n) throw new RangeError('Exponent must be non-negative');
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modInverse(a: bigint, mod: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = mod;
  let newR = modNorm(a, mod);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r !== 1n) throw new Error('Element not invertible modulo order');
  return t < 0n ? t + mod : t;
}

function randomScalar(): bigint {
  const raw = BigInt('0x' + randomBytes(32).toString('hex'));
  return (raw % (SUBGROUP_Q - 1n)) + 1n;
}

function hashScalar(domain: string, parts: Array<string | bigint>): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(typeof p === 'bigint' ? p.toString(16) : p);
  }
  return (BigInt('0x' + h.digest('hex')) % (SUBGROUP_Q - 1n)) + 1n;
}

export interface ThresholdKeyShare {
  readonly participantId: number;
  readonly secretShare: bigint;
  readonly publicShare: bigint;
}

export interface FeldmanDealingBundle {
  readonly threshold: number;
  readonly totalParticipants: number;
  readonly commitments: readonly bigint[];
  readonly groupPublicKey: bigint;
  readonly shares: readonly ThresholdKeyShare[];
}

export interface PresignatureShare {
  readonly participantId: number;
  readonly nonceCommitmentR: bigint;
  readonly nonceShareK: bigint;
  readonly maskProofNonce: bigint;
  readonly maskProofResponse: bigint;
}

export interface PresignatureSession {
  readonly sessionId: string;
  readonly participantIds: readonly number[];
  readonly combinedNonceR: bigint;
  readonly shares: readonly PresignatureShare[];
}

export interface PartialThresholdSignature {
  readonly participantId: number;
  readonly partialS: bigint;
  readonly publicKeyShare: bigint;
  readonly nonceCommitmentR: bigint;
}

export interface ReconstructedThresholdSignature {
  readonly sessionId: string;
  readonly messageDigest: bigint;
  readonly R: bigint;
  readonly s: bigint;
  readonly signerIds: readonly number[];
}

export class ThresholdECDSAPresignatureVerifier {
  public readonly p: bigint;
  public readonly q: bigint;
  public readonly g: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    this.p = p;
    this.q = q;
    this.g = g;
  }

  /**
   * Computes Lagrange interpolation coefficient lambda_i(0) mod Q for participantId within subset.
   */
  public lagrangeCoefficient(participantId: number, subset: readonly number[]): bigint {
    const xi = BigInt(participantId);
    let num = 1n;
    let den = 1n;
    for (const j of subset) {
      if (j === participantId) continue;
      const xj = BigInt(j);
      num = modNorm(num * modNorm(-xj, this.q), this.q);
      den = modNorm(den * modNorm(xi - xj, this.q), this.q);
    }
    return modNorm(num * modInverse(den, this.q), this.q);
  }

  /**
   * Deals a (threshold, totalParticipants) Feldman-VSS key sharing bundle.
   */
  public dealKeyShares(threshold: number, totalParticipants: number): FeldmanDealingBundle {
    if (!Number.isInteger(threshold) || !Number.isInteger(totalParticipants)) {
      throw new RangeError('threshold and totalParticipants must be integers');
    }
    if (threshold < 1 || threshold > totalParticipants) {
      throw new RangeError('Require 1 <= threshold <= totalParticipants');
    }

    const coeffs: bigint[] = [];
    const commitments: bigint[] = [];
    for (let j = 0; j < threshold; j++) {
      const a = randomScalar();
      coeffs.push(a);
      commitments.push(modPow(this.g, a, this.p));
    }

    const shares: ThresholdKeyShare[] = [];
    for (let i = 1; i <= totalParticipants; i++) {
      const x = BigInt(i);
      let y = 0n;
      let xPow = 1n;
      for (let j = 0; j < threshold; j++) {
        y = modNorm(y + coeffs[j] * xPow, this.q);
        xPow = modNorm(xPow * x, this.q);
      }
      shares.push({
        participantId: i,
        secretShare: y,
        publicShare: modPow(this.g, y, this.p),
      });
    }

    return {
      threshold,
      totalParticipants,
      commitments,
      groupPublicKey: commitments[0],
      shares,
    };
  }

  /**
   * Verifies a participant's Feldman-VSS share against the public polynomial commitments.
   */
  public verifyFeldmanShare(share: ThresholdKeyShare, commitments: readonly bigint[]): boolean {
    if (share.participantId < 1 || commitments.length === 0) return false;
    const lhs = modPow(this.g, modNorm(share.secretShare, this.q), this.p);
    if (lhs !== share.publicShare) return false;

    const x = BigInt(share.participantId);
    let rhs = 1n;
    let xPow = 1n;
    for (let j = 0; j < commitments.length; j++) {
      rhs = (rhs * modPow(commitments[j], xPow, this.p)) % this.p;
      xPow = modNorm(xPow * x, this.q);
    }
    return lhs === rhs;
  }

  /**
   * Generates a presignature share with a Fiat-Shamir Schnorr proof of nonce knowledge.
   */
  public createPresignatureShare(sessionId: string, participantId: number): PresignatureShare {
    const nonceShareK = randomScalar();
    const nonceCommitmentR = modPow(this.g, nonceShareK, this.p);
    const w = randomScalar();
    const maskProofNonce = modPow(this.g, w, this.p);
    const e = hashScalar('WorkSphere::ThresholdPresigNonce', [
      sessionId,
      BigInt(participantId),
      nonceCommitmentR,
      maskProofNonce,
    ]);
    const maskProofResponse = modNorm(w + e * nonceShareK, this.q);

    return {
      participantId,
      nonceCommitmentR,
      nonceShareK,
      maskProofNonce,
      maskProofResponse,
    };
  }

  public verifyPresignatureShare(sessionId: string, share: PresignatureShare): boolean {
    if (share.nonceCommitmentR <= 1n || share.nonceCommitmentR >= this.p) return false;
    const e = hashScalar('WorkSphere::ThresholdPresigNonce', [
      sessionId,
      BigInt(share.participantId),
      share.nonceCommitmentR,
      share.maskProofNonce,
    ]);
    const lhs = modPow(this.g, modNorm(share.maskProofResponse, this.q), this.p);
    const rhs = (share.maskProofNonce * modPow(share.nonceCommitmentR, e, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Aggregates validated presignature shares from a qualified t-subset into a presignature session.
   */
  public buildPresignatureSession(
    sessionId: string,
    shares: readonly PresignatureShare[]
  ): PresignatureSession {
    if (shares.length === 0) throw new Error('At least one presignature share required');
    const ids = shares.map((s) => s.participantId);
    if (new Set(ids).size !== ids.length) {
      throw new Error('Duplicate participant IDs in presignature session');
    }

    let combinedNonceR = 1n;
    for (const share of shares) {
      if (!this.verifyPresignatureShare(sessionId, share)) {
        throw new Error(`Invalid presignature share from participant ${share.participantId}`);
      }
      combinedNonceR = (combinedNonceR * share.nonceCommitmentR) % this.p;
    }

    return {
      sessionId,
      participantIds: ids,
      combinedNonceR,
      shares,
    };
  }

  public computeChallenge(groupPublicKey: bigint, R: bigint, message: string): bigint {
    return hashScalar('WorkSphere::ThresholdSchnorrSig', [groupPublicKey, R, message]);
  }

  /**
   * Produces a verifiable partial threshold signature from a participant's key & presignature share.
   */
  public signPartial(
    message: string,
    groupPublicKey: bigint,
    keyShare: ThresholdKeyShare,
    session: PresignatureSession
  ): PartialThresholdSignature {
    const presig = session.shares.find((s) => s.participantId === keyShare.participantId);
    if (!presig) {
      throw new Error(`Participant ${keyShare.participantId} not part of presignature session`);
    }
    const lambda = this.lagrangeCoefficient(keyShare.participantId, session.participantIds);
    const e = this.computeChallenge(groupPublicKey, session.combinedNonceR, message);
    const partialS = modNorm(presig.nonceShareK + e * modNorm(lambda * keyShare.secretShare, this.q), this.q);

    return {
      participantId: keyShare.participantId,
      partialS,
      publicKeyShare: keyShare.publicShare,
      nonceCommitmentR: presig.nonceCommitmentR,
    };
  }

  /**
   * Verifies an individual partial signature before aggregation (identifies faulty signers).
   */
  public verifyPartialSignature(
    message: string,
    groupPublicKey: bigint,
    partial: PartialThresholdSignature,
    session: PresignatureSession
  ): boolean {
    const lambda = this.lagrangeCoefficient(partial.participantId, session.participantIds);
    const e = this.computeChallenge(groupPublicKey, session.combinedNonceR, message);
    const lhs = modPow(this.g, modNorm(partial.partialS, this.q), this.p);
    const exp = modNorm(e * lambda, this.q);
    const rhs = (partial.nonceCommitmentR * modPow(partial.publicKeyShare, exp, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Combines verified partial signatures into a single constant-size group signature.
   */
  public aggregateSignatures(
    message: string,
    groupPublicKey: bigint,
    partials: readonly PartialThresholdSignature[],
    session: PresignatureSession
  ): ReconstructedThresholdSignature {
    if (partials.length !== session.participantIds.length) {
      throw new Error('Partial signature count must match presignature session participants');
    }
    let s = 0n;
    for (const part of partials) {
      if (!this.verifyPartialSignature(message, groupPublicKey, part, session)) {
        throw new Error(`Faulty partial signature detected from participant ${part.participantId}`);
      }
      s = modNorm(s + part.partialS, this.q);
    }

    const messageDigest = hashScalar('WorkSphere::MessageDigest', [message]);
    return {
      sessionId: session.sessionId,
      messageDigest,
      R: session.combinedNonceR,
      s,
      signerIds: partials.map((p) => p.participantId),
    };
  }

  /**
   * Verifies the final aggregated threshold signature using only the single group public key.
   */
  public verifyGroupSignature(
    message: string,
    groupPublicKey: bigint,
    signature: ReconstructedThresholdSignature
  ): boolean {
    const e = this.computeChallenge(groupPublicKey, signature.R, message);
    const lhs = modPow(this.g, modNorm(signature.s, this.q), this.p);
    const rhs = (signature.R * modPow(groupPublicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Identifies all faulty or malicious partial signers in a threshold signing round
   * without aborting on the first invalid share (cheater identification).
   */
  public auditPartialSignatures(
    message: string,
    groupPublicKey: bigint,
    partials: readonly PartialThresholdSignature[],
    session: PresignatureSession
  ): {
    allValid: boolean;
    validSigners: number[];
    faultySigners: number[];
    auditDigest: string;
  } {
    const validSigners: number[] = [];
    const faultySigners: number[] = [];

    for (const part of partials) {
      if (this.verifyPartialSignature(message, groupPublicKey, part, session)) {
        validSigners.push(part.participantId);
      } else {
        faultySigners.push(part.participantId);
      }
    }

    const auditDigest = createHash('sha256')
      .update(`${session.sessionId}|${message}|v:${validSigners.join(',')}|f:${faultySigners.join(',')}`)
      .digest('hex');

    return {
      allValid: faultySigners.length === 0 && validSigners.length === session.participantIds.length,
      validSigners,
      faultySigners,
      auditDigest,
    };
  }

  /**
   * Randomized batch verification of multiple aggregated group signatures under the same group public key.
   * Uses deterministic Fiat-Shamir weights rho_i to check:
   *   g^(Sum rho_i * s_i) == Prod (R_i^rho_i) * Y^(Sum rho_i * e_i) mod p
   */
  public batchVerifyGroupSignatures(
    groupPublicKey: bigint,
    items: ReadonlyArray<{ message: string; signature: ReconstructedThresholdSignature }>
  ): boolean {
    if (items.length === 0) return false;
    let totalS = 0n;
    let totalE = 0n;
    let prodR = 1n;

    for (let i = 0; i < items.length; i++) {
      const { message, signature } = items[i];
      const e = this.computeChallenge(groupPublicKey, signature.R, message);
      const rho = hashScalar('WorkSphere::ThresholdBatchWeight', [
        BigInt(i),
        groupPublicKey,
        signature.R,
        signature.s,
        message,
      ]);
      totalS = modNorm(totalS + rho * signature.s, this.q);
      totalE = modNorm(totalE + rho * e, this.q);
      prodR = (prodR * modPow(signature.R, rho, this.p)) % this.p;
    }

    const lhs = modPow(this.g, totalS, this.p);
    const rhs = (prodR * modPow(groupPublicKey, totalE, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Serializes a reconstructed threshold signature to portable JSON-safe hex strings.
   */
  public serializeSignature(signature: ReconstructedThresholdSignature): string {
    return JSON.stringify({
      sessionId: signature.sessionId,
      messageDigest: signature.messageDigest.toString(16),
      R: signature.R.toString(16),
      s: signature.s.toString(16),
      signerIds: [...signature.signerIds],
    });
  }

  /**
   * Deserializes a portable JSON payload back into a ReconstructedThresholdSignature.
   */
  public deserializeSignature(payload: string): ReconstructedThresholdSignature {
    const parsed = JSON.parse(payload) as {
      sessionId: string;
      messageDigest: string;
      R: string;
      s: string;
      signerIds: number[];
    };
    return {
      sessionId: parsed.sessionId,
      messageDigest: BigInt(`0x${parsed.messageDigest}`),
      R: BigInt(`0x${parsed.R}`),
      s: BigInt(`0x${parsed.s}`),
      signerIds: parsed.signerIds,
    };
  }
}
