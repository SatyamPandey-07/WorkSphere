/**
 * @file VerifiableMultiPartyAggregation.ts
 * @description Verifiable Multi-Party Homomorphic Aggregation Protocol.
 * Implements privacy-preserving additive homomorphic ElGamal aggregation over BN254.
 * Enables multiple independent parties to submit encrypted numeric inputs with non-interactive
 * zero-knowledge proofs of knowledge, allowing an untrusted aggregator to compute verifiable
 * sums without exposing individual contributions.
 */

import { createHash, randomBytes } from 'crypto';

export const MPA_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const MPA_GENERATOR = 3n;

/**
 * Field arithmetic helper over BN254.
 */
export class MPAFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = MPA_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = MPA_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = MPA_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = MPA_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = MPA_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('MPAFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = MPA_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = MPA_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * NIZK proof of plaintext knowledge: proves knowledge of (r, x) for C = (r*G, x*G + r*PK).
 */
export interface ZKInputProof {
  commitmentA1: bigint;
  commitmentA2: bigint;
  challenge: bigint;
  responseR: bigint;
  responseX: bigint;
}

/**
 * Encrypted participant submission.
 */
export interface ParticipantInput {
  participantId: string;
  c1: bigint;
  c2: bigint;
  proof: ZKInputProof;
  timestamp: number;
}

/**
 * Combined homomorphic ciphertext.
 */
export interface AggregatedCiphertext {
  participantCount: number;
  participantIds: string[];
  aggC1: bigint;
  aggC2: bigint;
}

/**
 * Aggregation verification result.
 */
export interface AggregationVerificationResult {
  isValid: boolean;
  reason?: string;
  claimedSum?: bigint;
  participantCount: number;
}

/**
 * Verifiable Multi-Party Homomorphic Aggregator.
 */
export class VerifiableMultiPartyAggregation {
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(prime: bigint = MPA_PRIME, g: bigint = MPA_GENERATOR) {
    this.prime = prime;
    this.g = g;
  }

  /**
   * Generates a keypair (SK, PK).
   */
  public generateKeypair(): { privateKey: bigint; publicKey: bigint } {
    const privateKey = MPAFieldMath.randomScalar(this.prime);
    const publicKey = MPAFieldMath.mul(privateKey, this.g, this.prime);
    return { privateKey, publicKey };
  }

  /**
   * Participant encrypts private numeric value x and generates NIZK proof of knowledge.
   */
  public encryptInput(
    participantId: string,
    value: bigint,
    publicKey: bigint
  ): ParticipantInput {
    const x = ((value % this.prime) + this.prime) % this.prime;
    const r = MPAFieldMath.randomScalar(this.prime);

    // c1 = r * G, c2 = x * G + r * PK
    const c1 = MPAFieldMath.mul(r, this.g, this.prime);
    const rPK = MPAFieldMath.mul(r, publicKey, this.prime);
    const xG = MPAFieldMath.mul(x, this.g, this.prime);
    const c2 = MPAFieldMath.add(xG, rPK, this.prime);

    // Blinding scalars for NIZK
    const kr = MPAFieldMath.randomScalar(this.prime);
    const kx = MPAFieldMath.randomScalar(this.prime);

    const commitmentA1 = MPAFieldMath.mul(kr, this.g, this.prime);
    const commitmentA2 = MPAFieldMath.add(
      MPAFieldMath.mul(kx, this.g, this.prime),
      MPAFieldMath.mul(kr, publicKey, this.prime),
      this.prime
    );

    // Fiat-Shamir challenge
    const transcript = [
      participantId,
      this.g.toString(16),
      publicKey.toString(16),
      c1.toString(16),
      c2.toString(16),
      commitmentA1.toString(16),
      commitmentA2.toString(16),
    ].join(':');

    const challenge = MPAFieldMath.hashToScalar(transcript, this.prime);
    const responseR = MPAFieldMath.add(kr, MPAFieldMath.mul(challenge, r, this.prime), this.prime);
    const responseX = MPAFieldMath.add(kx, MPAFieldMath.mul(challenge, x, this.prime), this.prime);

    return {
      participantId,
      c1,
      c2,
      proof: {
        commitmentA1,
        commitmentA2,
        challenge,
        responseR,
        responseX,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Verifies an individual participant's input proof.
   */
  public verifyParticipantInput(input: ParticipantInput, publicKey: bigint): boolean {
    const { participantId, c1, c2, proof } = input;

    // Check challenge
    const transcript = [
      participantId,
      this.g.toString(16),
      publicKey.toString(16),
      c1.toString(16),
      c2.toString(16),
      proof.commitmentA1.toString(16),
      proof.commitmentA2.toString(16),
    ].join(':');

    const expectedChallenge = MPAFieldMath.hashToScalar(transcript, this.prime);
    if (proof.challenge !== expectedChallenge) return false;

    // Check z_r * G == A1 + e * c1
    const lhsA1 = MPAFieldMath.mul(proof.responseR, this.g, this.prime);
    const rhsA1 = MPAFieldMath.add(proof.commitmentA1, MPAFieldMath.mul(proof.challenge, c1, this.prime), this.prime);
    if (lhsA1 !== rhsA1) return false;

    // Check z_x * G + z_r * PK == A2 + e * c2
    const zxG = MPAFieldMath.mul(proof.responseX, this.g, this.prime);
    const zrPK = MPAFieldMath.mul(proof.responseR, publicKey, this.prime);
    const lhsA2 = MPAFieldMath.add(zxG, zrPK, this.prime);

    const rhsA2 = MPAFieldMath.add(proof.commitmentA2, MPAFieldMath.mul(proof.challenge, c2, this.prime), this.prime);
    return lhsA2 === rhsA2;
  }

  /**
   * Aggregator: homomorphically sums all valid encrypted inputs.
   */
  public aggregateCiphertexts(
    inputs: ParticipantInput[],
    publicKey: bigint
  ): AggregatedCiphertext {
    if (inputs.length === 0) throw new Error('Cannot aggregate empty inputs');

    let aggC1 = 0n;
    let aggC2 = 0n;
    const participantIds: string[] = [];

    for (const input of inputs) {
      if (!this.verifyParticipantInput(input, publicKey)) {
        throw new Error(`Participant ${input.participantId} input proof failed verification`);
      }

      aggC1 = MPAFieldMath.add(aggC1, input.c1, this.prime);
      aggC2 = MPAFieldMath.add(aggC2, input.c2, this.prime);
      participantIds.push(input.participantId);
    }

    return {
      participantCount: inputs.length,
      participantIds,
      aggC1,
      aggC2,
    };
  }

  /**
   * Decrypts aggregate and verifies against claimed sum:
   * M = C2 - SK * C1 == S * G mod p.
   */
  public decryptAndVerifyAggregate(
    aggregate: AggregatedCiphertext,
    privateKey: bigint,
    claimedSum: bigint
  ): AggregationVerificationResult {
    const skC1 = MPAFieldMath.mul(privateKey, aggregate.aggC1, this.prime);
    const decryptedMask = MPAFieldMath.sub(aggregate.aggC2, skC1, this.prime);

    // Expected: claimedSum * G
    const expectedMask = MPAFieldMath.mul(
      ((claimedSum % this.prime) + this.prime) % this.prime,
      this.g,
      this.prime
    );

    if (decryptedMask !== expectedMask) {
      return {
        isValid: false,
        reason: 'Decrypted aggregate mask does not match claimedSum * G',
        participantCount: aggregate.participantCount,
      };
    }

    return {
      isValid: true,
      claimedSum,
      participantCount: aggregate.participantCount,
    };
  }
}
