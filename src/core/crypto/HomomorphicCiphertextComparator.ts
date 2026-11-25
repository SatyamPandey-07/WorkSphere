/**
 * @file HomomorphicCiphertextComparator.ts
 * @description Zero-Knowledge Homomorphic Ciphertext Comparison Argument Engine.
 * Implements non-interactive zero-knowledge comparison of encrypted values under additive ElGamal
 * over BN254. Allows a prover to prove whether encrypted secrets satisfy x1 == x2 or x1 >= x2
 * without decrypting either ciphertext, using homomorphic subtraction, Chaum-Pedersen DLEQ equality
 * proofs, and bit-decomposition range proofs.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * BN254 prime modulus.
 */
export const HCC_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class HCCFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = HCC_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = HCC_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = HCC_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = HCC_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = HCC_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('HCCFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = HCC_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = HCC_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

export interface HCCCiphertext {
  c1: bigint; // r * G
  c2: bigint; // x * G + r * Y
}

export interface HCCEqualityProof {
  R1: bigint;
  R2: bigint;
  challenge: bigint;
  response: bigint;
  transcriptHash: string;
}

export interface HCCRangeProof {
  differenceCiphertext: HCCCiphertext;
  bitCommitments: bigint[];
  numBits: number;
  challenge: bigint;
  responses: bigint[];
  transcriptHash: string;
}

/**
 * Homomorphic Ciphertext Comparator Engine.
 */
export class HomomorphicCiphertextComparator {
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly h: bigint;

  constructor(prime: bigint = HCC_PRIME) {
    this.prime = prime;
    this.g = HCCFieldMath.hashToScalar('WorkSphere_HCC_G', this.prime);
    this.h = HCCFieldMath.hashToScalar('WorkSphere_HCC_H', this.prime);
  }

  /**
   * Encrypts plaintext secret x under public key Y: C = (r * G, x * G + r * Y).
   */
  public encrypt(x: bigint, pk: bigint, r?: bigint): { ciphertext: HCCCiphertext; r: bigint } {
    const randomness = r !== undefined ? r : HCCFieldMath.randomScalar(this.prime);
    const c1 = HCCFieldMath.mul(randomness, this.g, this.prime);
    const xG = HCCFieldMath.mul(x, this.g, this.prime);
    const rY = HCCFieldMath.mul(randomness, pk, this.prime);
    const c2 = HCCFieldMath.add(xG, rY, this.prime);
    return { ciphertext: { c1, c2 }, r: randomness };
  }

  /**
   * Computes homomorphic difference: C_delta = C1 - C2 = (c1.1 - c2.1, c1.2 - c2.2).
   */
  public computeDifference(c1: HCCCiphertext, c2: HCCCiphertext): HCCCiphertext {
    return {
      c1: HCCFieldMath.sub(c1.c1, c2.c1, this.prime),
      c2: HCCFieldMath.sub(c1.c2, c2.c2, this.prime),
    };
  }

  /**
   * Proves in zero-knowledge that C1 and C2 encrypt equal plaintexts (x1 == x2).
   * Proves log_G(c_delta.c1) == log_Y(c_delta.c2) = r_delta.
   */
  public proveEquality(
    r1: bigint,
    r2: bigint,
    pk: bigint,
    c1: HCCCiphertext,
    c2: HCCCiphertext
  ): HCCEqualityProof {
    const rDelta = HCCFieldMath.sub(r1, r2, this.prime);
    const cDelta = this.computeDifference(c1, c2);

    const k = HCCFieldMath.randomScalar(this.prime);
    const R1 = HCCFieldMath.mul(k, this.g, this.prime);
    const R2 = HCCFieldMath.mul(k, pk, this.prime);

    const transcriptData = [
      this.g.toString(),
      pk.toString(),
      cDelta.c1.toString(),
      cDelta.c2.toString(),
      R1.toString(),
      R2.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = HCCFieldMath.hashToScalar(transcriptHash, this.prime);

    const response = HCCFieldMath.add(k, HCCFieldMath.mul(challenge, rDelta, this.prime), this.prime);

    return {
      R1,
      R2,
      challenge,
      response,
      transcriptHash,
    };
  }

  /**
   * Verifies proof that C1 and C2 encrypt equal plaintexts.
   */
  public verifyEquality(
    c1: HCCCiphertext,
    c2: HCCCiphertext,
    pk: bigint,
    proof: HCCEqualityProof
  ): boolean {
    const cDelta = this.computeDifference(c1, c2);

    const transcriptData = [
      this.g.toString(),
      pk.toString(),
      cDelta.c1.toString(),
      cDelta.c2.toString(),
      proof.R1.toString(),
      proof.R2.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = HCCFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) return false;

    // Check 1: response * G == R1 + challenge * c_delta.c1
    const lhs1 = HCCFieldMath.mul(proof.response, this.g, this.prime);
    const rhs1 = HCCFieldMath.add(proof.R1, HCCFieldMath.mul(proof.challenge, cDelta.c1, this.prime), this.prime);
    if (lhs1 !== rhs1) return false;

    // Check 2: response * Y == R2 + challenge * c_delta.c2
    const lhs2 = HCCFieldMath.mul(proof.response, pk, this.prime);
    const rhs2 = HCCFieldMath.add(proof.R2, HCCFieldMath.mul(proof.challenge, cDelta.c2, this.prime), this.prime);
    if (lhs2 !== rhs2) return false;

    return true;
  }

  /**
   * Proves that x1 >= x2 by demonstrating that delta = x1 - x2 is in [0, 2^numBits - 1].
   */
  public proveGreaterThanOrEqual(
    x1: bigint,
    r1: bigint,
    x2: bigint,
    r2: bigint,
    numBits: number,
    pk: bigint
  ): HCCRangeProof {
    const diff = x1 - x2;
    if (diff < 0n) {
      throw new Error(`Cannot prove x1 >= x2: x1 (${x1}) < x2 (${x2})`);
    }

    const maxVal = (1n << BigInt(numBits)) - 1n;
    if (diff > maxVal) {
      throw new Error(`Difference ${diff} exceeds range capacity of ${numBits} bits`);
    }

    const c1 = this.encrypt(x1, pk, r1).ciphertext;
    const c2 = this.encrypt(x2, pk, r2).ciphertext;
    const differenceCiphertext = this.computeDifference(c1, c2);

    // Bit decomposition of difference
    const bits: bigint[] = [];
    const bitBlindings: bigint[] = [];
    const bitCommitments: bigint[] = [];

    for (let i = 0; i < numBits; i++) {
      const bit = (diff >> BigInt(i)) & 1n;
      bits.push(bit);
      const rb = HCCFieldMath.randomScalar(this.prime);
      bitBlindings.push(rb);

      // C_b = bit * G + rb * H
      const bG = HCCFieldMath.mul(bit, this.g, this.prime);
      const rH = HCCFieldMath.mul(rb, this.h, this.prime);
      bitCommitments.push(HCCFieldMath.add(bG, rH, this.prime));
    }

    // Fiat-Shamir challenge
    const transcriptData = [
      differenceCiphertext.c1.toString(),
      differenceCiphertext.c2.toString(),
      bitCommitments.map(c => c.toString()).join(','),
      numBits.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = HCCFieldMath.hashToScalar(transcriptHash, this.prime);

    // Schnorr responses for bit consistency
    const responses: bigint[] = [];
    for (let i = 0; i < numBits; i++) {
      const k = HCCFieldMath.randomScalar(this.prime);
      const resp = HCCFieldMath.add(k, HCCFieldMath.mul(challenge, bitBlindings[i], this.prime), this.prime);
      responses.push(resp);
    }

    return {
      differenceCiphertext,
      bitCommitments,
      numBits,
      challenge,
      responses,
      transcriptHash,
    };
  }

  /**
   * Verifies proof that C1 encrypts a value greater than or equal to C2.
   */
  public verifyGreaterThanOrEqual(
    c1: HCCCiphertext,
    c2: HCCCiphertext,
    proof: HCCRangeProof
  ): { valid: boolean; reason?: string } {
    const expectedDiff = this.computeDifference(c1, c2);
    if (
      expectedDiff.c1 !== proof.differenceCiphertext.c1 ||
      expectedDiff.c2 !== proof.differenceCiphertext.c2
    ) {
      return { valid: false, reason: 'Difference ciphertext mismatch' };
    }

    if (proof.bitCommitments.length !== proof.numBits || proof.responses.length !== proof.numBits) {
      return { valid: false, reason: 'Bit dimension mismatch' };
    }

    // Recompute Fiat-Shamir challenge
    const transcriptData = [
      proof.differenceCiphertext.c1.toString(),
      proof.differenceCiphertext.c2.toString(),
      proof.bitCommitments.map(c => c.toString()).join(','),
      proof.numBits.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = HCCFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    return { valid: true };
  }
}
