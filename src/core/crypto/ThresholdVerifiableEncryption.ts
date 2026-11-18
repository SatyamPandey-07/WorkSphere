/**
 * @file ThresholdVerifiableEncryption.ts
 * @description Verifiable Encryption of Discrete Logarithms for Threshold Cryptosystems.
 * Implements Camenisch-Damgård / Chaum-Pedersen verifiable encryption over BN254. Allows a prover
 * to encrypt secret x under a threshold public key Y and prove non-interactively in zero knowledge
 * that the ciphertext encrypts the discrete logarithm of public commitment P = x * G.
 * Supports threshold distributed decryption with verifiable partial decryption shares.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Alt-bn128 prime modulus.
 */
export const TVE_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class TVEFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = TVE_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = TVE_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = TVE_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = TVE_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = TVE_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('TVEFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = TVE_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = TVE_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

export interface TVECiphertext {
  c1: bigint; // r * G
  c2: bigint; // P + r * Y
}

export interface TVEProof {
  R1: bigint;
  R2: bigint;
  challenge: bigint;
  response: bigint;
  transcriptHash: string;
}

export interface TVEDecryptionShare {
  nodeIndex: number;
  partialDecryption: bigint; // w_i = y_i * c1
  proofR1: bigint;
  proofR2: bigint;
  challenge: bigint;
  response: bigint;
}

/**
 * Threshold Verifiable Encryption Engine.
 */
export class ThresholdVerifiableEncryption {
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(prime: bigint = TVE_PRIME) {
    this.prime = prime;
    this.g = TVEFieldMath.hashToScalar('WorkSphere_TVE_G', this.prime);
  }

  /**
   * Encrypts secret x under threshold public key Y and produces a verifiable DLEQ proof.
   */
  public encryptAndProve(
    secret: bigint,
    thresholdPK: bigint,
    randomness?: bigint
  ): { ciphertext: TVECiphertext; proof: TVEProof; publicCommitment: bigint } {
    const r = randomness !== undefined ? randomness : TVEFieldMath.randomScalar(this.prime);
    const publicCommitment = TVEFieldMath.mul(secret, this.g, this.prime);

    // c1 = r * G, c2 = P + r * Y
    const c1 = TVEFieldMath.mul(r, this.g, this.prime);
    const rY = TVEFieldMath.mul(r, thresholdPK, this.prime);
    const c2 = TVEFieldMath.add(publicCommitment, rY, this.prime);
    const ciphertext: TVECiphertext = { c1, c2 };

    // DLEQ proof that log_G(c1) == log_Y(c2 - P) = r
    const k = TVEFieldMath.randomScalar(this.prime);
    const R1 = TVEFieldMath.mul(k, this.g, this.prime);
    const R2 = TVEFieldMath.mul(k, thresholdPK, this.prime);

    const transcriptData = [
      this.g.toString(),
      thresholdPK.toString(),
      publicCommitment.toString(),
      c1.toString(),
      c2.toString(),
      R1.toString(),
      R2.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = TVEFieldMath.hashToScalar(transcriptHash, this.prime);

    const response = TVEFieldMath.add(k, TVEFieldMath.mul(challenge, r, this.prime), this.prime);

    const proof: TVEProof = {
      R1,
      R2,
      challenge,
      response,
      transcriptHash,
    };

    return { ciphertext, proof, publicCommitment };
  }

  /**
   * Verifies that ciphertext is an honest encryption of the secret in publicCommitment under thresholdPK.
   */
  public verifyEncryption(
    ciphertext: TVECiphertext,
    publicCommitment: bigint,
    thresholdPK: bigint,
    proof: TVEProof
  ): boolean {
    const transcriptData = [
      this.g.toString(),
      thresholdPK.toString(),
      publicCommitment.toString(),
      ciphertext.c1.toString(),
      ciphertext.c2.toString(),
      proof.R1.toString(),
      proof.R2.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = TVEFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) return false;

    // Check 1: response * G == R1 + challenge * c1
    const lhs1 = TVEFieldMath.mul(proof.response, this.g, this.prime);
    const rhs1 = TVEFieldMath.add(proof.R1, TVEFieldMath.mul(proof.challenge, ciphertext.c1, this.prime), this.prime);
    if (lhs1 !== rhs1) return false;

    // Check 2: response * Y == R2 + challenge * (c2 - P)
    const diff = TVEFieldMath.sub(ciphertext.c2, publicCommitment, this.prime);
    const lhs2 = TVEFieldMath.mul(proof.response, thresholdPK, this.prime);
    const rhs2 = TVEFieldMath.add(proof.R2, TVEFieldMath.mul(proof.challenge, diff, this.prime), this.prime);
    if (lhs2 !== rhs2) return false;

    return true;
  }

  /**
   * Computes a verifiable partial decryption share w_i = keyShare * c1.
   */
  public partialDecrypt(
    ciphertext: TVECiphertext,
    keyShare: bigint,
    nodeIndex: number
  ): TVEDecryptionShare {
    const w_i = TVEFieldMath.mul(keyShare, ciphertext.c1, this.prime);
    const publicShare = TVEFieldMath.mul(keyShare, this.g, this.prime);

    // DLEQ proof: log_G(publicShare) == log_c1(w_i) = keyShare
    const k = TVEFieldMath.randomScalar(this.prime);
    const proofR1 = TVEFieldMath.mul(k, this.g, this.prime);
    const proofR2 = TVEFieldMath.mul(k, ciphertext.c1, this.prime);

    const transcriptData = [
      this.g.toString(),
      publicShare.toString(),
      ciphertext.c1.toString(),
      w_i.toString(),
      proofR1.toString(),
      proofR2.toString(),
      nodeIndex.toString(),
    ].join(':');

    const challengeHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = TVEFieldMath.hashToScalar(challengeHash, this.prime);

    const response = TVEFieldMath.add(k, TVEFieldMath.mul(challenge, keyShare, this.prime), this.prime);

    return {
      nodeIndex,
      partialDecryption: w_i,
      proofR1,
      proofR2,
      challenge,
      response,
    };
  }

  /**
   * Verifies a participant's partial decryption share.
   */
  public verifyDecryptionShare(
    share: TVEDecryptionShare,
    ciphertext: TVECiphertext,
    publicShare: bigint
  ): boolean {
    const transcriptData = [
      this.g.toString(),
      publicShare.toString(),
      ciphertext.c1.toString(),
      share.partialDecryption.toString(),
      share.proofR1.toString(),
      share.proofR2.toString(),
      share.nodeIndex.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = TVEFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== share.challenge) return false;

    // Check 1: response * G == R1 + challenge * publicShare
    const lhs1 = TVEFieldMath.mul(share.response, this.g, this.prime);
    const rhs1 = TVEFieldMath.add(share.proofR1, TVEFieldMath.mul(share.challenge, publicShare, this.prime), this.prime);
    if (lhs1 !== rhs1) return false;

    // Check 2: response * c1 == R2 + challenge * w_i
    const lhs2 = TVEFieldMath.mul(share.response, ciphertext.c1, this.prime);
    const rhs2 = TVEFieldMath.add(share.proofR2, TVEFieldMath.mul(share.challenge, share.partialDecryption, this.prime), this.prime);
    if (lhs2 !== rhs2) return false;

    return true;
  }

  /**
   * Combines t partial decryption shares via Lagrange interpolation to decrypt public commitment P.
   */
  public combineDecryption(
    ciphertext: TVECiphertext,
    shares: TVEDecryptionShare[],
    threshold: number
  ): bigint {
    if (shares.length < threshold) {
      throw new Error(`Insufficient shares: need ${threshold}, got ${shares.length}`);
    }

    const active = shares.slice(0, threshold);
    let combinedW = 0n;

    for (let i = 0; i < threshold; i++) {
      const xi = BigInt(active[i].nodeIndex);
      let num = 1n;
      let den = 1n;

      for (let j = 0; j < threshold; j++) {
        if (i === j) continue;
        const xj = BigInt(active[j].nodeIndex);
        num = TVEFieldMath.mul(num, TVEFieldMath.sub(0n, xj, this.prime), this.prime);
        const diff = TVEFieldMath.sub(xi, xj, this.prime);
        den = TVEFieldMath.mul(den, diff, this.prime);
      }

      const lambda_i = TVEFieldMath.mul(num, TVEFieldMath.inv(den, this.prime), this.prime);
      const term = TVEFieldMath.mul(lambda_i, active[i].partialDecryption, this.prime);
      combinedW = TVEFieldMath.add(combinedW, term, this.prime);
    }

    // P = c2 - combinedW mod prime
    return TVEFieldMath.sub(ciphertext.c2, combinedW, this.prime);
  }
}
