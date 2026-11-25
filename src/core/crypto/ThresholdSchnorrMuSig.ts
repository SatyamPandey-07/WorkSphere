/**
 * @file ThresholdSchnorrMuSig.ts
 * @description Verifiable Two-Round MuSig2 Threshold Schnorr Multi-Signature Engine.
 * Aggregates N independent public keys into a single rogue-key-resistant group key using
 * domain-separated weighting coefficients a_i = H(L, PK_i) and produces a constant-size
 * standard Schnorr signature (R, s) verifiable in O(1) over the BN254 scalar field.
 */

import { createHash, randomBytes } from 'crypto';

export const MUSIG_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const MUSIG_GENERATOR = 3n;

/**
 * Field arithmetic utilities over BN254.
 */
export class MuSigFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = MUSIG_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = MUSIG_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = MUSIG_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static hashToScalar(tag: string, data: string, p: bigint = MUSIG_PRIME): bigint {
    const h = createHash('sha256').update(`${tag}:${data}`).digest('hex');
    const val = BigInt('0x' + h) % p;
    return val === 0n ? 1n : val;
  }

  public static randomScalar(p: bigint = MUSIG_PRIME): bigint {
    const b = randomBytes(32);
    const val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

export interface MuSigKeyPair {
  signerId: string;
  scalar: bigint;
  publicKey: bigint;
}

export interface AggregatedPublicKey {
  keyListHash: string;
  coefficients: Map<string, bigint>;
  aggregatedKey: bigint;
  signerIds: string[];
}

export interface MuSigNonceState {
  signerId: string;
  r1: bigint;
  r2: bigint;
  pubR1: bigint;
  pubR2: bigint;
}

export interface MuSigNonceCommitment {
  signerId: string;
  pubR1: bigint;
  pubR2: bigint;
}

export interface MuSigAggregatedNonce {
  aggR1: bigint;
  aggR2: bigint;
  bindingCoeff: bigint;
  effectiveR: bigint;
  challenge: bigint;
}

export interface MuSigPartialSignature {
  signerId: string;
  partialS: bigint;
}

export interface MuSigFinalSignature {
  effectiveR: bigint;
  scalarS: bigint;
  aggregatedKey: bigint;
}

/**
 * MuSig2 Two-Round Schnorr Multi-Signature Engine.
 */
export class ThresholdSchnorrMuSig {
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(prime: bigint = MUSIG_PRIME, g: bigint = MUSIG_GENERATOR) {
    this.prime = prime;
    this.g = g;
  }

  /**
   * Generates a signer keypair over BN254.
   */
  public generateKeyPair(signerId: string, scalarOverride?: bigint): MuSigKeyPair {
    const scalar = scalarOverride !== undefined
      ? ((scalarOverride % this.prime) + this.prime) % this.prime
      : MuSigFieldMath.randomScalar(this.prime);
    const publicKey = MuSigFieldMath.mul(scalar, this.g, this.prime);
    return { signerId, scalar, publicKey };
  }

  /**
   * Aggregates signer public keys with rogue-key-resistant MuSig2 coefficients a_i = H(L, PK_i).
   */
  public aggregatePublicKeys(
    signers: { signerId: string; publicKey: bigint }[]
  ): AggregatedPublicKey {
    if (signers.length === 0) {
      throw new Error('Cannot aggregate empty signer list');
    }

    const sorted = [...signers].sort((a, b) => a.signerId.localeCompare(b.signerId));
    const keyListHash = createHash('sha256')
      .update(sorted.map((s) => `${s.signerId}:${s.publicKey.toString(16)}`).join('|'))
      .digest('hex');

    const coefficients = new Map<string, bigint>();
    let aggregatedKey = 0n;

    for (const s of sorted) {
      const a_i = MuSigFieldMath.hashToScalar(
        'musig2_keyagg',
        `${keyListHash}:${s.signerId}:${s.publicKey.toString(16)}`,
        this.prime
      );
      coefficients.set(s.signerId, a_i);
      aggregatedKey = MuSigFieldMath.add(
        aggregatedKey,
        MuSigFieldMath.mul(a_i, s.publicKey, this.prime),
        this.prime
      );
    }

    return {
      keyListHash,
      coefficients,
      aggregatedKey,
      signerIds: sorted.map((s) => s.signerId),
    };
  }

  /**
   * Round 1: Generates a signer's dual nonce state and public commitments (R1, R2).
   */
  public generateNoncePair(signerId: string): {
    state: MuSigNonceState;
    commitment: MuSigNonceCommitment;
  } {
    const r1 = MuSigFieldMath.randomScalar(this.prime);
    const r2 = MuSigFieldMath.randomScalar(this.prime);
    const pubR1 = MuSigFieldMath.mul(r1, this.g, this.prime);
    const pubR2 = MuSigFieldMath.mul(r2, this.g, this.prime);

    return {
      state: { signerId, r1, r2, pubR1, pubR2 },
      commitment: { signerId, pubR1, pubR2 },
    };
  }

  /**
   * Aggregates Round-1 nonce commitments and derives MuSig2 binding coefficient b & challenge c.
   */
  public aggregateNonces(
    commitments: MuSigNonceCommitment[],
    aggKey: AggregatedPublicKey,
    message: string
  ): MuSigAggregatedNonce {
    if (commitments.length !== aggKey.signerIds.length) {
      throw new Error('Nonce commitment count must match aggregated key signer count');
    }

    let aggR1 = 0n;
    let aggR2 = 0n;
    for (const c of commitments) {
      aggR1 = MuSigFieldMath.add(aggR1, c.pubR1, this.prime);
      aggR2 = MuSigFieldMath.add(aggR2, c.pubR2, this.prime);
    }

    const bindingCoeff = MuSigFieldMath.hashToScalar(
      'musig2_nonce_bind',
      `${aggKey.aggregatedKey.toString(16)}:${aggR1.toString(16)}:${aggR2.toString(16)}:${message}`,
      this.prime
    );

    const effectiveR = MuSigFieldMath.add(
      aggR1,
      MuSigFieldMath.mul(bindingCoeff, aggR2, this.prime),
      this.prime
    );

    const challenge = MuSigFieldMath.hashToScalar(
      'musig2_sig_chal',
      `${aggKey.aggregatedKey.toString(16)}:${effectiveR.toString(16)}:${message}`,
      this.prime
    );

    return { aggR1, aggR2, bindingCoeff, effectiveR, challenge };
  }

  /**
   * Round 2: Produces partial Schnorr signature s_i = r_{i,1} + b * r_{i,2} + c * a_i * x_i mod p.
   */
  public createPartialSignature(
    keyPair: MuSigKeyPair,
    nonceState: MuSigNonceState,
    aggKey: AggregatedPublicKey,
    aggNonce: MuSigAggregatedNonce
  ): MuSigPartialSignature {
    const a_i = aggKey.coefficients.get(keyPair.signerId);
    if (a_i === undefined) {
      throw new Error(`Signer ${keyPair.signerId} not present in aggregated key`);
    }

    const nonceTerm = MuSigFieldMath.add(
      nonceState.r1,
      MuSigFieldMath.mul(aggNonce.bindingCoeff, nonceState.r2, this.prime),
      this.prime
    );
    const keyTerm = MuSigFieldMath.mul(
      aggNonce.challenge,
      MuSigFieldMath.mul(a_i, keyPair.scalar, this.prime),
      this.prime
    );

    return {
      signerId: keyPair.signerId,
      partialS: MuSigFieldMath.add(nonceTerm, keyTerm, this.prime),
    };
  }

  /**
   * Verifies an individual signer's partial signature prior to final aggregation.
   */
  public verifyPartialSignature(
    partial: MuSigPartialSignature,
    signerPublicKey: bigint,
    nonceCommitment: MuSigNonceCommitment,
    aggKey: AggregatedPublicKey,
    aggNonce: MuSigAggregatedNonce
  ): boolean {
    const a_i = aggKey.coefficients.get(partial.signerId);
    if (a_i === undefined) return false;

    const lhs = MuSigFieldMath.mul(partial.partialS, this.g, this.prime);

    const noncePub = MuSigFieldMath.add(
      nonceCommitment.pubR1,
      MuSigFieldMath.mul(aggNonce.bindingCoeff, nonceCommitment.pubR2, this.prime),
      this.prime
    );
    const keyPub = MuSigFieldMath.mul(
      aggNonce.challenge,
      MuSigFieldMath.mul(a_i, signerPublicKey, this.prime),
      this.prime
    );
    const rhs = MuSigFieldMath.add(noncePub, keyPub, this.prime);

    return lhs === rhs;
  }

  /**
   * Aggregates verified partial signatures into a single constant-size Schnorr signature (R, s).
   */
  public aggregateSignatures(
    partials: MuSigPartialSignature[],
    aggKey: AggregatedPublicKey,
    aggNonce: MuSigAggregatedNonce
  ): MuSigFinalSignature {
    let scalarS = 0n;
    for (const p of partials) {
      scalarS = MuSigFieldMath.add(scalarS, p.partialS, this.prime);
    }

    return {
      effectiveR: aggNonce.effectiveR,
      scalarS,
      aggregatedKey: aggKey.aggregatedKey,
    };
  }

  /**
   * Standard O(1) Schnorr verification indistinguishable from a single-signer signature:
   * Checks s * G == R + c * aggregatedKey mod p.
   */
  public verifyFinalSignature(signature: MuSigFinalSignature, message: string): boolean {
    const challenge = MuSigFieldMath.hashToScalar(
      'musig2_sig_chal',
      `${signature.aggregatedKey.toString(16)}:${signature.effectiveR.toString(16)}:${message}`,
      this.prime
    );

    const lhs = MuSigFieldMath.mul(signature.scalarS, this.g, this.prime);
    const rhs = MuSigFieldMath.add(
      signature.effectiveR,
      MuSigFieldMath.mul(challenge, signature.aggregatedKey, this.prime),
      this.prime
    );

    return lhs === rhs;
  }
}
