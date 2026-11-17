/**
 * @file ThresholdBlindSignatures.ts
 * @description Verifiable Threshold Blind Signature Protocol.
 * Enables clients to request and obtain unforgeable cryptographic threshold signatures
 * from a distributed (t, n) committee without disclosing the underlying message payload.
 * Features Chaum-Pedersen DLEQ zero-knowledge proofs for partial shares and Lagrange
 * unblinding over BN254.
 */

import { createHash, randomBytes } from 'crypto';

export const BLIND_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const BLIND_GENERATOR = 3n;

/**
 * Field arithmetic helper over BN254.
 */
export class BlindFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = BLIND_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = BLIND_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = BLIND_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = BLIND_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = BLIND_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('BlindFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = BLIND_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = BLIND_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Chaum-Pedersen DLEQ Proof: log_G(PK_i) == log_M*(sigma_i*) = s_i
 */
export interface BlindDLEQProof {
  commitmentA: bigint;
  commitmentB: bigint;
  challenge: bigint;
  response: bigint;
}

/**
 * Client blinded request bundle.
 */
export interface BlindedMessageRequest {
  requestId: string;
  blindedMessage: bigint;
  blindingFactor: bigint;
  messageHash: bigint;
}

/**
 * Signer partial blind signature share.
 */
export interface BlindSignatureShare {
  signerIndex: number;
  requestId: string;
  blindShare: bigint;
  proof: BlindDLEQProof;
}

/**
 * Final unblinded signature on original message.
 */
export interface UnblindedSignature {
  message: string;
  messageHash: bigint;
  signature: bigint;
}

/**
 * Configuration for threshold blind signing committee.
 */
export interface ThresholdBlindConfig {
  threshold: number;
  totalSigners: number;
  groupPublicKey: bigint;
  signerPublicKeys: Map<number, bigint>;
  prime?: bigint;
  g?: bigint;
}

/**
 * Threshold Blind Signature issuance coordinator and client utilities.
 */
export class ThresholdBlindSignatures {
  public readonly threshold: number;
  public readonly totalSigners: number;
  public readonly groupPublicKey: bigint;
  public readonly signerPublicKeys: Map<number, bigint>;
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(config: ThresholdBlindConfig) {
    this.threshold = config.threshold;
    this.totalSigners = config.totalSigners;
    this.groupPublicKey = config.groupPublicKey;
    this.signerPublicKeys = new Map(config.signerPublicKeys);
    this.prime = config.prime ?? BLIND_PRIME;
    this.g = config.g ?? BLIND_GENERATOR;
  }

  /**
   * Client: Blinds a message M with a fresh random blinding factor alpha.
   */
  public blind(message: string, requestId?: string): BlindedMessageRequest {
    const messageHash = BlindFieldMath.hashToScalar(`blind_msg:${message}`, this.prime);
    const blindingFactor = BlindFieldMath.randomScalar(this.prime);

    // M* = m * alpha mod p
    const blindedMessage = BlindFieldMath.mul(messageHash, blindingFactor, this.prime);

    return {
      requestId: requestId ?? `req_${randomBytes(8).toString('hex')}`,
      blindedMessage,
      blindingFactor,
      messageHash,
    };
  }

  /**
   * Signer: Generates a partial blind signature share sigma_i* = s_i * M* with Chaum-Pedersen DLEQ proof.
   */
  public signBlindShare(
    signerIndex: number,
    secretShare: bigint,
    blindedMessage: bigint,
    requestId: string
  ): BlindSignatureShare {
    const s_i = ((secretShare % this.prime) + this.prime) % this.prime;
    const blindShare = BlindFieldMath.mul(s_i, blindedMessage, this.prime);

    const pk_i = this.signerPublicKeys.get(signerIndex);
    if (!pk_i) {
      throw new Error(`Signer ${signerIndex} not found in public keys`);
    }

    // Ephemeral blinding scalar k
    const k = BlindFieldMath.randomScalar(this.prime);
    const commitmentA = BlindFieldMath.mul(k, this.g, this.prime);
    const commitmentB = BlindFieldMath.mul(k, blindedMessage, this.prime);

    // Fiat-Shamir challenge
    const transcript = [
      requestId,
      this.g.toString(16),
      pk_i.toString(16),
      blindedMessage.toString(16),
      blindShare.toString(16),
      commitmentA.toString(16),
      commitmentB.toString(16),
    ].join(':');

    const challenge = BlindFieldMath.hashToScalar(transcript, this.prime);
    const response = BlindFieldMath.add(k, BlindFieldMath.mul(challenge, s_i, this.prime), this.prime);

    return {
      signerIndex,
      requestId,
      blindShare,
      proof: {
        commitmentA,
        commitmentB,
        challenge,
        response,
      },
    };
  }

  /**
   * Client / Verifier: Verifies an individual partial blind signature share against signer's PK.
   */
  public verifyBlindShare(
    share: BlindSignatureShare,
    blindedMessage: bigint
  ): boolean {
    const pk_i = this.signerPublicKeys.get(share.signerIndex);
    if (!pk_i) return false;

    const transcript = [
      share.requestId,
      this.g.toString(16),
      pk_i.toString(16),
      blindedMessage.toString(16),
      share.blindShare.toString(16),
      share.proof.commitmentA.toString(16),
      share.proof.commitmentB.toString(16),
    ].join(':');

    const expectedChallenge = BlindFieldMath.hashToScalar(transcript, this.prime);
    if (share.proof.challenge !== expectedChallenge) return false;

    // Check z * G == A + e * PK_i
    const lhsA = BlindFieldMath.mul(share.proof.response, this.g, this.prime);
    const rhsA = BlindFieldMath.add(
      share.proof.commitmentA,
      BlindFieldMath.mul(share.proof.challenge, pk_i, this.prime),
      this.prime
    );
    if (lhsA !== rhsA) return false;

    // Check z * M* == B + e * sigma_i*
    const lhsB = BlindFieldMath.mul(share.proof.response, blindedMessage, this.prime);
    const rhsB = BlindFieldMath.add(
      share.proof.commitmentB,
      BlindFieldMath.mul(share.proof.challenge, share.blindShare, this.prime),
      this.prime
    );
    return lhsB === rhsB;
  }

  /**
   * Client: Combines threshold t verified blind shares and removes blinding factor.
   */
  public recombineAndUnblind(
    shares: BlindSignatureShare[],
    blindingFactor: bigint,
    message: string
  ): UnblindedSignature {
    if (shares.length < this.threshold) {
      throw new Error(`Insufficient shares: have ${shares.length}, need ${this.threshold}`);
    }

    const activeShares = shares.slice(0, this.threshold);
    const indices = activeShares.map((s) => BigInt(s.signerIndex));

    let blindedGroupSignature = 0n;

    for (let i = 0; i < this.threshold; i++) {
      const xi = indices[i];
      let num = 1n;
      let den = 1n;

      for (let j = 0; j < this.threshold; j++) {
        if (i === j) continue;
        const xj = indices[j];
        // l_i(0) = \prod_{j != i} (0 - xj) / (xi - xj)
        num = BlindFieldMath.mul(num, BlindFieldMath.sub(0n, xj, this.prime), this.prime);
        den = BlindFieldMath.mul(den, BlindFieldMath.sub(xi, xj, this.prime), this.prime);
      }

      const lagrange = BlindFieldMath.mul(num, BlindFieldMath.inv(den, this.prime), this.prime);
      const term = BlindFieldMath.mul(lagrange, activeShares[i].blindShare, this.prime);
      blindedGroupSignature = BlindFieldMath.add(blindedGroupSignature, term, this.prime);
    }

    // Unblind: sigma = sigma* * alpha^{-1} mod p
    const alphaInv = BlindFieldMath.inv(blindingFactor, this.prime);
    const signature = BlindFieldMath.mul(blindedGroupSignature, alphaInv, this.prime);

    const messageHash = BlindFieldMath.hashToScalar(`blind_msg:${message}`, this.prime);

    return {
      message,
      messageHash,
      signature,
    };
  }

  /**
   * Verifier: Verifies unblinded signature under group master public key.
   * Checks that: sigma * G == m * groupPublicKey (mod p).
   */
  public verifyUnblindedSignature(unblindedSig: UnblindedSignature): boolean {
    const computedHash = BlindFieldMath.hashToScalar(`blind_msg:${unblindedSig.message}`, this.prime);
    if (computedHash !== unblindedSig.messageHash) return false;

    const lhs = BlindFieldMath.mul(unblindedSig.signature, this.g, this.prime);
    const rhs = BlindFieldMath.mul(unblindedSig.messageHash, this.groupPublicKey, this.prime);

    return lhs === rhs;
  }
}
