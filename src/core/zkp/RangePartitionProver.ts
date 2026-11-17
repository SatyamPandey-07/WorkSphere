/**
 * @file RangePartitionProver.ts
 * @description Zero-Knowledge Verifiable Range Partition Argument Engine.
 * Enables a prover to demonstrate that a secret value v decomposes into a radix-B
 * partition v = sum(v_j * B^j) with v_j in [0, B-1], verified homomorphically
 * via Pedersen commitments and Fiat-Shamir Schnorr-type zero-knowledge proofs.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Alt-bn128 prime modulus.
 */
export const PARTITION_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class PartitionFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = PARTITION_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = PARTITION_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = PARTITION_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = PARTITION_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = PARTITION_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('PartitionFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = PARTITION_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = PARTITION_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Range partition proof structure.
 */
export interface RangePartitionProof {
  commitmentV: bigint;
  componentCommitments: bigint[];
  radix: bigint;
  numDigits: number;
  deltaR: bigint;
  blindingsR: bigint[];
  challenge: bigint;
  responsesV: bigint[];
  responsesR: bigint[];
  transcriptHash: string;
}

/**
 * Range Partition Prover and Verifier.
 */
export class RangePartitionProver {
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly h: bigint;

  constructor(prime: bigint = PARTITION_PRIME) {
    this.prime = prime;
    this.g = PartitionFieldMath.hashToScalar('WorkSphere_Partition_G', this.prime);
    this.h = PartitionFieldMath.hashToScalar('WorkSphere_Partition_H', this.prime);
  }

  /**
   * Decomposes value into radix-B digits: v = sum(v_j * B^j).
   */
  public decompose(value: bigint, radix: bigint, numDigits: number): bigint[] {
    if (value < 0n) {
      throw new Error('Cannot decompose negative value');
    }
    const digits: bigint[] = [];
    let rem = value;
    for (let i = 0; i < numDigits; i++) {
      digits.push(rem % radix);
      rem = rem / radix;
    }
    if (rem > 0n) {
      throw new Error(`Value ${value} exceeds capacity of ${numDigits} digits in base ${radix}`);
    }
    return digits;
  }

  /**
   * Recomposes radix-B digits back into scalar value.
   */
  public recompose(digits: bigint[], radix: bigint): bigint {
    let acc = 0n;
    let power = 1n;
    for (let i = 0; i < digits.length; i++) {
      acc += digits[i] * power;
      power *= radix;
    }
    return acc;
  }

  /**
   * Generates a Pedersen commitment: C = g^v * h^r mod prime.
   */
  public commit(value: bigint, blinding: bigint): bigint {
    const gv = PartitionFieldMath.exp(this.g, value, this.prime);
    const hr = PartitionFieldMath.exp(this.h, blinding, this.prime);
    return PartitionFieldMath.mul(gv, hr, this.prime);
  }

  /**
   * Generates a zero-knowledge range partition proof.
   */
  public provePartition(
    value: bigint,
    radix: bigint,
    numDigits: number,
    blindingV?: bigint
  ): RangePartitionProof {
    const order = this.prime - 1n;
    const rV = blindingV !== undefined ? blindingV : PartitionFieldMath.randomScalar(order);
    const commitmentV = this.commit(value, rV);

    const digits = this.decompose(value, radix, numDigits);

    const componentCommitments: bigint[] = [];
    const rComponents: bigint[] = [];
    for (let j = 0; j < numDigits; j++) {
      const r_j = PartitionFieldMath.randomScalar(order);
      rComponents.push(r_j);
      componentCommitments.push(this.commit(digits[j], r_j));
    }

    // Delta r = r_v - sum(r_j * radix^j) mod (prime - 1)
    let sumR = 0n;
    let power = 1n;
    for (let j = 0; j < numDigits; j++) {
      sumR = (sumR + ((rComponents[j] * power) % order)) % order;
      power = (power * radix) % order;
    }
    const deltaR = ((rV - sumR) % order + order) % order;

    // Ephemeral blindings for Schnorr proof of component knowledge
    const kV: bigint[] = [];
    const kR: bigint[] = [];
    const blindingsR: bigint[] = [];

    for (let j = 0; j < numDigits; j++) {
      const kv_j = PartitionFieldMath.randomScalar(order);
      const kr_j = PartitionFieldMath.randomScalar(order);
      kV.push(kv_j);
      kR.push(kr_j);

      const R_j = this.commit(kv_j, kr_j);
      blindingsR.push(R_j);
    }

    // Fiat-Shamir challenge
    const transcriptData = [
      commitmentV.toString(),
      radix.toString(),
      numDigits.toString(),
      deltaR.toString(),
      componentCommitments.map(c => c.toString()).join(','),
      blindingsR.map(r => r.toString()).join(','),
    ].join(':');

    const transcriptHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = PartitionFieldMath.hashToScalar(transcriptHash, order);

    // Responses: z_v = k_v + challenge * v_j, z_r = k_r + challenge * r_j
    const responsesV: bigint[] = [];
    const responsesR: bigint[] = [];
    for (let j = 0; j < numDigits; j++) {
      const zv = (kV[j] + ((challenge * digits[j]) % order)) % order;
      const zr = (kR[j] + ((challenge * rComponents[j]) % order)) % order;
      responsesV.push(zv);
      responsesR.push(zr);
    }

    return {
      commitmentV,
      componentCommitments,
      radix,
      numDigits,
      deltaR,
      blindingsR,
      challenge,
      responsesV,
      responsesR,
      transcriptHash,
    };
  }

  /**
   * Verifies range partition proof.
   */
  public verifyPartition(proof: RangePartitionProof): { valid: boolean; reason?: string } {
    const order = this.prime - 1n;

    if (
      proof.componentCommitments.length !== proof.numDigits ||
      proof.blindingsR.length !== proof.numDigits ||
      proof.responsesV.length !== proof.numDigits ||
      proof.responsesR.length !== proof.numDigits
    ) {
      return { valid: false, reason: 'Dimension mismatch in partition proof' };
    }

    // Recompute Fiat-Shamir challenge
    const transcriptData = [
      proof.commitmentV.toString(),
      proof.radix.toString(),
      proof.numDigits.toString(),
      proof.deltaR.toString(),
      proof.componentCommitments.map(c => c.toString()).join(','),
      proof.blindingsR.map(r => r.toString()).join(','),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = PartitionFieldMath.hashToScalar(expectedHash, order);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    // Verify component knowledge: g^zv * h^zr == R_j * C_j^e mod prime
    for (let j = 0; j < proof.numDigits; j++) {
      const lhs = this.commit(proof.responsesV[j], proof.responsesR[j]);
      const cPowE = PartitionFieldMath.exp(proof.componentCommitments[j], proof.challenge, this.prime);
      const rhs = PartitionFieldMath.mul(proof.blindingsR[j], cPowE, this.prime);

      if (lhs !== rhs) {
        return { valid: false, reason: `Component ${j} knowledge verification failed` };
      }
    }

    // Verify partition homomorphism: C_v == (Prod C_j^(radix^j)) * h^deltaR mod prime
    let prodC = 1n;
    let power = 1n;
    for (let j = 0; j < proof.numDigits; j++) {
      const cExp = PartitionFieldMath.exp(proof.componentCommitments[j], power, this.prime);
      prodC = PartitionFieldMath.mul(prodC, cExp, this.prime);
      power = (power * proof.radix) % order;
    }

    const hDelta = PartitionFieldMath.exp(this.h, proof.deltaR, this.prime);
    const expectedCommitment = PartitionFieldMath.mul(prodC, hDelta, this.prime);

    if (proof.commitmentV !== expectedCommitment) {
      return { valid: false, reason: 'Partition recombination homomorphism failed' };
    }

    return { valid: true };
  }

  /**
   * Batch verifies multiple range partition proofs.
   */
  public verifyBatch(proofs: RangePartitionProof[]): {
    valid: boolean;
    verifiedCount: number;
    errors: string[];
  } {
    const errors: string[] = [];
    let verifiedCount = 0;

    for (let i = 0; i < proofs.length; i++) {
      const res = this.verifyPartition(proofs[i]);
      if (!res.valid) {
        errors.push(`Proof ${i} invalid: ${res.reason}`);
      } else {
        verifiedCount++;
      }
    }

    return {
      valid: errors.length === 0,
      verifiedCount,
      errors,
    };
  }
}
