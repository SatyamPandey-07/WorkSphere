import { createHash } from 'crypto';

/**
 * Zero-Knowledge Threshold Schnorr Adaptor Signature Protocol
 *
 * Implements (t, n) threshold Schnorr Adaptor Signatures (Aumayr et al. /
 * Fournier 2019) over a safe-prime subgroup (P = 2Q + 1) for scriptless atomic
 * swaps and conditional settlement:
 *   1. Shamir (t, n) committee key sharing with public verification points X_i = g^{x_i}
 *   2. Collaboratively generated adaptor pre-signature (R, s_hat) locked to an
 *      adaptor statement Y = g^y with challenge e = H(m, X, R * Y)
 *   3. Public pre-signature verification: g^{s_hat} == R * X^e mod P
 *   4. Adaptation using adaptor witness y: s = (s_hat + y) mod Q yielding a
 *      standard valid Schnorr signature (R * Y, s)
 *   5. Public witness extraction from (preSig, fullSig): y = (s - s_hat) mod Q
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Order-Q quadratic residue generator

export interface SignerShare {
  readonly signerId: number;
  readonly shareScalar: bigint;
  readonly publicVerificationPoint: bigint;
}

export interface ThresholdCommittee {
  readonly threshold: number;
  readonly totalSigners: number;
  readonly groupPublicKeyX: bigint;
  readonly signers: readonly SignerShare[];
}

export interface AdaptorStatement {
  readonly adaptorWitnessY: bigint;
  readonly adaptorPointY: bigint;
}

export interface PartialPreSignature {
  readonly signerId: number;
  readonly messageDigest: string;
  readonly noncePointR_i: bigint;
  readonly partialSHat: bigint;
}

export interface AdaptorPreSignature {
  readonly messageDigest: string;
  readonly groupPublicKeyX: bigint;
  readonly adaptorPointY: bigint;
  readonly aggregateNonceR: bigint;
  readonly preSignatureSHat: bigint;
  readonly challengeE: bigint;
  readonly signerIds: readonly number[];
  readonly preSigDigest: string;
}

export interface AdaptedSchnorrSignature {
  readonly messageDigest: string;
  readonly groupPublicKeyX: bigint;
  readonly effectiveNonceRY: bigint;
  readonly signatureS: bigint;
}

export interface WitnessExtractionResult {
  readonly isValid: boolean;
  readonly extractedWitnessY: bigint;
  readonly matchesAdaptorPoint: boolean;
  readonly reason?: string;
}

function modQ(x: bigint): bigint {
  const r = x % SUBGROUP_ORDER;
  return r >= 0n ? r : r + SUBGROUP_ORDER;
}

function modP(x: bigint): bigint {
  const r = x % SAFE_PRIME;
  return r >= 0n ? r : r + SAFE_PRIME;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInverseQ(a: bigint): bigint {
  const val = modQ(a);
  if (val === 0n) throw new Error('Cannot invert zero mod Q');
  return modPow(val, SUBGROUP_ORDER - 2n, SUBGROUP_ORDER);
}

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function lagrangeCoeffAtZero(signerId: number, signerIds: readonly number[]): bigint {
  const xI = BigInt(signerId);
  let num = 1n;
  let den = 1n;
  for (const otherId of signerIds) {
    if (otherId === signerId) continue;
    const xJ = BigInt(otherId);
    num = modQ(num * modQ(-xJ));
    den = modQ(den * modQ(xI - xJ));
  }
  return modQ(num * modInverseQ(den));
}

export class ThresholdAdaptorSignature {
  private readonly threshold: number;
  private readonly totalSigners: number;

  constructor(threshold: number, totalSigners: number) {
    if (!Number.isInteger(threshold) || !Number.isInteger(totalSigners)) {
      throw new Error('threshold and totalSigners must be integers');
    }
    if (threshold < 2 || threshold > totalSigners) {
      throw new Error('Require 2 <= threshold <= totalSigners');
    }
    this.threshold = threshold;
    this.totalSigners = totalSigners;
  }

  public generateCommittee(seed: string): ThresholdCommittee {
    const coeffs: bigint[] = [];
    for (let k = 0; k < this.threshold; k++) {
      coeffs.push(hashToScalar('ADAPTOR_POLY', [seed, String(k)]));
    }
    const groupPublicKeyX = modPow(SUBGROUP_GEN, coeffs[0], SAFE_PRIME);
    const signers: SignerShare[] = [];

    for (let id = 1; id <= this.totalSigners; id++) {
      const x = BigInt(id);
      let y = 0n;
      let xPow = 1n;
      for (let k = 0; k < coeffs.length; k++) {
        y = modQ(y + modQ(coeffs[k] * xPow));
        xPow = modQ(xPow * x);
      }
      signers.push({
        signerId: id,
        shareScalar: y,
        publicVerificationPoint: modPow(SUBGROUP_GEN, y, SAFE_PRIME),
      });
    }

    return {
      threshold: this.threshold,
      totalSigners: this.totalSigners,
      groupPublicKeyX,
      signers,
    };
  }

  public createAdaptorStatement(witnessSeed: string): AdaptorStatement {
    const adaptorWitnessY = hashToScalar('ADAPTOR_WITNESS', [witnessSeed]);
    const adaptorPointY = modPow(SUBGROUP_GEN, adaptorWitnessY, SAFE_PRIME);
    return { adaptorWitnessY, adaptorPointY };
  }

  public generateSignerNonce(
    signerId: number,
    messageDigest: string,
    sessionNonce: string
  ): { nonceScalar: bigint; noncePointR: bigint } {
    const nonceScalar = hashToScalar('ADAPTOR_SIGNER_K', [
      String(signerId),
      messageDigest,
      sessionNonce,
    ]);
    const noncePointR = modPow(SUBGROUP_GEN, nonceScalar, SAFE_PRIME);
    return { nonceScalar, noncePointR };
  }

  public computeChallenge(
    messageDigest: string,
    groupPublicKeyX: bigint,
    effectiveNonceRY: bigint
  ): bigint {
    return hashToScalar('ADAPTOR_SCHNORR_E', [
      messageDigest,
      groupPublicKeyX.toString(16),
      effectiveNonceRY.toString(16),
    ]);
  }

  public createPartialPreSignature(
    signer: SignerShare,
    participatingIds: readonly number[],
    nonceScalar: bigint,
    noncePointR_i: bigint,
    aggregateNonceR: bigint,
    adaptorPointY: bigint,
    groupPublicKeyX: bigint,
    messageDigest: string
  ): PartialPreSignature {
    const effectiveRY = modP(aggregateNonceR * adaptorPointY);
    const e = this.computeChallenge(messageDigest, groupPublicKeyX, effectiveRY);
    const lambda = lagrangeCoeffAtZero(signer.signerId, participatingIds);
    const partialSHat = modQ(modQ(nonceScalar) + modQ(e * modQ(lambda * modQ(signer.shareScalar))));

    return {
      signerId: signer.signerId,
      messageDigest,
      noncePointR_i,
      partialSHat,
    };
  }

  public verifyPartialPreSignature(
    partial: PartialPreSignature,
    signerPublicPoint: bigint,
    participatingIds: readonly number[],
    aggregateNonceR: bigint,
    adaptorPointY: bigint,
    groupPublicKeyX: bigint
  ): boolean {
    const effectiveRY = modP(aggregateNonceR * adaptorPointY);
    const e = this.computeChallenge(partial.messageDigest, groupPublicKeyX, effectiveRY);
    const lambda = lagrangeCoeffAtZero(partial.signerId, participatingIds);
    const lhs = modPow(SUBGROUP_GEN, modQ(partial.partialSHat), SAFE_PRIME);
    const rhs = modP(
      partial.noncePointR_i * modPow(signerPublicPoint, modQ(e * lambda), SAFE_PRIME)
    );
    return lhs === rhs;
  }

  public aggregatePreSignature(
    messageDigest: string,
    groupPublicKeyX: bigint,
    adaptorPointY: bigint,
    partials: readonly PartialPreSignature[],
    publicPointsBySigner: ReadonlyMap<number, bigint>
  ): AdaptorPreSignature {
    if (partials.length < this.threshold) {
      throw new Error(`Need at least ${this.threshold} partial pre-signatures`);
    }
    const selected = partials.slice(0, this.threshold);
    const signerIds = selected.map((p) => p.signerId);
    if (new Set(signerIds).size !== signerIds.length) {
      throw new Error('Duplicate signer IDs detected');
    }

    let aggregateNonceR = 1n;
    for (const p of selected) {
      if (p.messageDigest !== messageDigest) {
        throw new Error(`Message digest mismatch from signer ${p.signerId}`);
      }
      aggregateNonceR = modP(aggregateNonceR * p.noncePointR_i);
    }

    let preSignatureSHat = 0n;
    for (const p of selected) {
      const pubPoint = publicPointsBySigner.get(p.signerId);
      if (
        !pubPoint ||
        !this.verifyPartialPreSignature(
          p,
          pubPoint,
          signerIds,
          aggregateNonceR,
          adaptorPointY,
          groupPublicKeyX
        )
      ) {
        throw new Error(`Invalid partial pre-signature from signer ${p.signerId}`);
      }
      preSignatureSHat = modQ(preSignatureSHat + p.partialSHat);
    }

    const effectiveRY = modP(aggregateNonceR * adaptorPointY);
    const challengeE = this.computeChallenge(messageDigest, groupPublicKeyX, effectiveRY);
    const sortedIds = [...signerIds].sort((a, b) => a - b);
    const preSigDigest = createHash('sha256')
      .update(`ADAPTOR_PRESIG|${messageDigest}|${sortedIds.join(',')}|`)
      .update(`${groupPublicKeyX.toString(16)}|${adaptorPointY.toString(16)}|`)
      .update(`${aggregateNonceR.toString(16)}|${preSignatureSHat.toString(16)}`)
      .digest('hex');

    return {
      messageDigest,
      groupPublicKeyX,
      adaptorPointY,
      aggregateNonceR,
      preSignatureSHat,
      challengeE,
      signerIds: sortedIds,
      preSigDigest,
    };
  }

  public verifyPreSignature(preSig: AdaptorPreSignature): boolean {
    const sortedIds = [...preSig.signerIds].sort((a, b) => a - b);
    const expectedDigest = createHash('sha256')
      .update(`ADAPTOR_PRESIG|${preSig.messageDigest}|${sortedIds.join(',')}|`)
      .update(`${preSig.groupPublicKeyX.toString(16)}|${preSig.adaptorPointY.toString(16)}|`)
      .update(`${preSig.aggregateNonceR.toString(16)}|${preSig.preSignatureSHat.toString(16)}`)
      .digest('hex');
    if (expectedDigest !== preSig.preSigDigest) {
      return false;
    }

    const effectiveRY = modP(preSig.aggregateNonceR * preSig.adaptorPointY);
    const expectedE = this.computeChallenge(preSig.messageDigest, preSig.groupPublicKeyX, effectiveRY);
    if (expectedE !== preSig.challengeE) {
      return false;
    }

    const lhs = modPow(SUBGROUP_GEN, modQ(preSig.preSignatureSHat), SAFE_PRIME);
    const rhs = modP(
      preSig.aggregateNonceR * modPow(preSig.groupPublicKeyX, expectedE, SAFE_PRIME)
    );
    return lhs === rhs;
  }

  public adaptPreSignature(
    preSig: AdaptorPreSignature,
    adaptorWitnessY: bigint
  ): AdaptedSchnorrSignature {
    if (!this.verifyPreSignature(preSig)) {
      throw new Error('Cannot adapt an invalid pre-signature');
    }
    if (modPow(SUBGROUP_GEN, modQ(adaptorWitnessY), SAFE_PRIME) !== preSig.adaptorPointY) {
      throw new Error('Adaptor witness does not match pre-signature adaptor point Y');
    }
    return {
      messageDigest: preSig.messageDigest,
      groupPublicKeyX: preSig.groupPublicKeyX,
      effectiveNonceRY: modP(preSig.aggregateNonceR * preSig.adaptorPointY),
      signatureS: modQ(preSig.preSignatureSHat + modQ(adaptorWitnessY)),
    };
  }

  public verifyAdaptedSignature(sig: AdaptedSchnorrSignature): boolean {
    const e = this.computeChallenge(sig.messageDigest, sig.groupPublicKeyX, sig.effectiveNonceRY);
    const lhs = modPow(SUBGROUP_GEN, modQ(sig.signatureS), SAFE_PRIME);
    const rhs = modP(sig.effectiveNonceRY * modPow(sig.groupPublicKeyX, e, SAFE_PRIME));
    return lhs === rhs;
  }

  public extractAdaptorWitness(
    preSig: AdaptorPreSignature,
    fullSig: AdaptedSchnorrSignature
  ): WitnessExtractionResult {
    if (!this.verifyPreSignature(preSig) || !this.verifyAdaptedSignature(fullSig)) {
      return {
        isValid: false,
        extractedWitnessY: 0n,
        matchesAdaptorPoint: false,
        reason: 'Pre-signature or full signature verification failed',
      };
    }
    const expectedRY = modP(preSig.aggregateNonceR * preSig.adaptorPointY);
    if (
      fullSig.messageDigest !== preSig.messageDigest ||
      fullSig.groupPublicKeyX !== preSig.groupPublicKeyX ||
      fullSig.effectiveNonceRY !== expectedRY
    ) {
      return {
        isValid: false,
        extractedWitnessY: 0n,
        matchesAdaptorPoint: false,
        reason: 'Full signature does not correspond to the adaptor pre-signature',
      };
    }

    const extractedWitnessY = modQ(fullSig.signatureS - preSig.preSignatureSHat);
    const matchesAdaptorPoint =
      modPow(SUBGROUP_GEN, extractedWitnessY, SAFE_PRIME) === preSig.adaptorPointY;

    return {
      isValid: matchesAdaptorPoint,
      extractedWitnessY,
      matchesAdaptorPoint,
      reason: matchesAdaptorPoint ? undefined : 'Extracted scalar does not match adaptor point Y',
    };
  }
}
