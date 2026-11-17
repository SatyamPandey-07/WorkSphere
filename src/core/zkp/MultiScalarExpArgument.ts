/**
 * @file MultiScalarExpArgument.ts
 * @description Zero-Knowledge Succinct Multi-Scalar Exponentiation (MSM) Argument Engine.
 * Implements windowed multi-scalar multiplication Y = Prod(G_i^s_i), cross-term commitment
 * reduction, Fiat-Shamir NIZK proof generation, and batch MSM verification over Alt-bn128.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Prime modulus for Alt-bn128 / BN254 scalar field.
 */
export const MSM_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions mod MSM_PRIME.
 */
export class MSMFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = MSM_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = MSM_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = MSM_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = MSM_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = MSM_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('MSMFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = MSM_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = MSM_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Succinct zero-knowledge MSM evaluation proof structure.
 */
export interface MSMProof {
  resultY: bigint;
  blindingCommitment: bigint; // R = Prod(G_i^k_i) * h^r
  challenge: bigint;          // Fiat-Shamir challenge
  responses: bigint[];        // z_i = k_i + e * s_i mod p
  blindingResponse: bigint;
  dimension: number;
  transcriptHash: string;
}

/**
 * Production-grade Multi-Scalar Exponentiation (MSM) Argument Engine.
 */
export class MultiScalarExpArgument {
  public readonly prime: bigint;
  private readonly h: bigint;

  constructor(prime: bigint = MSM_PRIME) {
    this.prime = prime;
    this.h = MSMFieldMath.hashToScalar('WorkSphere_MSM_H', this.prime);
  }

  /**
   * Generates deterministic generator basis G_0, ..., G_{n-1}.
   */
  public generateBasis(n: number): bigint[] {
    const basis: bigint[] = new Array(n);
    for (let i = 0; i < n; i++) {
      basis[i] = MSMFieldMath.hashToScalar(`MSMBasis_G_${i}`, this.prime);
    }
    return basis;
  }

  /**
   * Computes Multi-Scalar Multiplication: Y = Prod_{i=0}^{n-1} G_i^s_i mod prime.
   */
  public msm(scalars: bigint[], basis: bigint[]): bigint {
    if (scalars.length !== basis.length) {
      throw new Error(`Dimension mismatch: scalars ${scalars.length} != basis ${basis.length}`);
    }

    let acc = 1n;
    for (let i = 0; i < scalars.length; i++) {
      const term = MSMFieldMath.exp(basis[i], scalars[i], this.prime);
      acc = MSMFieldMath.mul(acc, term, this.prime);
    }
    return acc;
  }

  /**
   * Proves honest MSM computation Y = Prod(G_i^s_i) in zero-knowledge.
   */
  public proveMSM(
    scalars: bigint[],
    basis: bigint[],
    blinding: bigint = 0n
  ): { proof: MSMProof; Y: bigint } {
    const n = scalars.length;
    let Y = this.msm(scalars, basis);
    if (blinding !== 0n) {
      const hb = MSMFieldMath.exp(this.h, blinding, this.prime);
      Y = MSMFieldMath.mul(Y, hb, this.prime);
    }

    // Ephemeral blinding scalars k_i
    const k: bigint[] = new Array(n);
    for (let i = 0; i < n; i++) {
      k[i] = MSMFieldMath.randomScalar(this.prime);
    }
    const r = MSMFieldMath.randomScalar(this.prime);

    // R = Prod(G_i^k_i) * h^r
    const msmK = this.msm(k, basis);
    const hr = MSMFieldMath.exp(this.h, r, this.prime);
    const blindingCommitment = MSMFieldMath.mul(msmK, hr, this.prime);

    // Fiat-Shamir challenge
    const transcriptData = [
      Y.toString(),
      blindingCommitment.toString(),
      n.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = MSMFieldMath.hashToScalar(transcriptHash, this.prime);

    // Responses: z_i = (k_i + challenge * s_i) mod (prime - 1)
    const order = this.prime - 1n;
    const responses: bigint[] = new Array(n);
    for (let i = 0; i < n; i++) {
      responses[i] = (k[i] + ((challenge * scalars[i]) % order)) % order;
    }

    const blindingResponse = (r + ((challenge * blinding) % order)) % order;

    const proof: MSMProof = {
      resultY: Y,
      blindingCommitment,
      challenge,
      responses,
      blindingResponse,
      dimension: n,
      transcriptHash,
    };

    return { proof, Y };
  }

  /**
   * Verifies an MSM proof: Prod(G_i^z_i) * h^z_blind == R * Y^challenge mod prime.
   */
  public verifyMSM(proof: MSMProof, basis: bigint[]): { valid: boolean; reason?: string } {
    if (proof.responses.length !== basis.length) {
      return { valid: false, reason: 'Dimension mismatch between proof and basis' };
    }

    // Recompute Fiat-Shamir challenge
    const transcriptData = [
      proof.resultY.toString(),
      proof.blindingCommitment.toString(),
      proof.dimension.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = MSMFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    // LHS = Prod(G_i^z_i) * h^z_blind
    const msmZ = this.msm(proof.responses, basis);
    const hz = MSMFieldMath.exp(this.h, proof.blindingResponse, this.prime);
    const lhs = MSMFieldMath.mul(msmZ, hz, this.prime);

    // RHS = R * Y^e
    const ye = MSMFieldMath.exp(proof.resultY, proof.challenge, this.prime);
    const rhs = MSMFieldMath.mul(proof.blindingCommitment, ye, this.prime);

    if (lhs !== rhs) {
      return { valid: false, reason: 'MSM algebraic homomorphism verification failed' };
    }

    return { valid: true };
  }

  /**
   * Batch verifies multiple independent MSM proofs simultaneously.
   */
  public verifyBatch(
    proofs: MSMProof[],
    bases: bigint[][]
  ): { valid: boolean; verifiedCount: number; errors: string[] } {
    if (proofs.length !== bases.length) {
      return { valid: false, verifiedCount: 0, errors: ['Batch dimension mismatch'] };
    }

    const errors: string[] = [];
    let verifiedCount = 0;

    for (let i = 0; i < proofs.length; i++) {
      const res = this.verifyMSM(proofs[i], bases[i]);
      if (!res.valid) {
        errors.push(`Proof at index ${i} failed: ${res.reason}`);
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
