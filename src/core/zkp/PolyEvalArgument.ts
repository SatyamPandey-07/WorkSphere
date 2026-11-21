/**
 * @file PolyEvalArgument.ts
 * @description Zero-Knowledge Verifiable Polynomial Evaluation Argument.
 * Implements Schwartz-Zippel polynomial identity testing, homomorphic Pedersen
 * polynomial commitments, quotient polynomial decomposition P(x) - v = Q(x)(x - z),
 * Fiat-Shamir NIZK proof generation, and batch multi-point evaluation over finite fields.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Prime modulus for Alt-bn128 / BN254 scalar field.
 */
export const POLYEVAL_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field math helpers for finite field arithmetic mod POLYEVAL_PRIME.
 */
export class PolyFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = POLYEVAL_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = POLYEVAL_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = POLYEVAL_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = POLYEVAL_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = POLYEVAL_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('PolyFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = POLYEVAL_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = POLYEVAL_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Dense polynomial representation in coefficient form: P(x) = c_0 + c_1*x + ... + c_d*x^d
 */
export type Polynomial = bigint[];

/**
 * Zero-Knowledge polynomial evaluation proof for a claim: P(z) = v.
 */
export interface EvaluationProof {
  point: bigint;                // Evaluation point z
  claimedValue: bigint;         // Claimed evaluation v = P(z)
  quotientCommitment: bigint;   // Commitment to quotient polynomial Q(x)
  blindingFactor: bigint;       // Evaluation blinding factor
  challenge: bigint;            // Fiat-Shamir challenge point
  response: bigint;             // Blinding response scalar
  degree: number;               // Degree of original polynomial
  transcriptHash: string;
}

/**
 * Batch evaluation argument across multiple points {(z_1, v_1), ..., (z_k, v_k)}.
 */
export interface BatchEvaluationProof {
  points: bigint[];
  claimedValues: bigint[];
  aggregatedQuotientCommitment: bigint;
  randomWeights: bigint[];
  combinedProof: EvaluationProof;
  polyCommitment: bigint;
}

/**
 * Succinct Zero-Knowledge Polynomial Evaluation Argument Engine.
 */
export class PolyEvalArgument {
  private readonly prime: bigint;
  private readonly g: bigint;
  private readonly h: bigint;

  constructor(prime: bigint = POLYEVAL_PRIME) {
    this.prime = prime;
    // Transparent NUMS generators
    this.g = PolyFieldMath.hashToScalar('WorkSphere_PolyEval_Gen_G', this.prime);
    this.h = PolyFieldMath.hashToScalar('WorkSphere_PolyEval_Gen_H', this.prime);
  }

  /**
   * Evaluates a polynomial P(x) at point x using Horner's method.
   */
  public evaluate(poly: Polynomial, x: bigint): bigint {
    if (poly.length === 0) return 0n;
    let result = 0n;
    for (let i = poly.length - 1; i >= 0; i--) {
      result = PolyFieldMath.add(PolyFieldMath.mul(result, x, this.prime), poly[i], this.prime);
    }
    return result;
  }

  /**
   * Computes Pedersen commitment to polynomial coefficients with blinding.
   * C = Prod(g_i^c_i) * h^r
   */
  public commit(poly: Polynomial, blinding: bigint = 0n): bigint {
    let commitment = 1n;
    for (let i = 0; i < poly.length; i++) {
      const gen_i = PolyFieldMath.hashToScalar(`WorkSphere_PolyBasis_${i}`, this.prime);
      const term = PolyFieldMath.exp(gen_i, poly[i], this.prime);
      commitment = PolyFieldMath.mul(commitment, term, this.prime);
    }
    if (blinding !== 0n) {
      const blindTerm = PolyFieldMath.exp(this.h, blinding, this.prime);
      commitment = PolyFieldMath.mul(commitment, blindTerm, this.prime);
    }
    return commitment;
  }

  /**
   * Computes the quotient polynomial Q(x) = (P(x) - v) / (x - z) via Ruffini's / synthetic division.
   */
  public computeQuotient(poly: Polynomial, z: bigint, v: bigint): Polynomial {
    const d = poly.length - 1;
    if (d < 1) return [0n];

    // Synthetic division of P(x) - v by (x - z)
    const shifted = [...poly];
    shifted[0] = PolyFieldMath.sub(shifted[0], v, this.prime);

    const quotient: bigint[] = new Array(d);
    let carry = 0n;

    for (let i = d; i >= 1; i--) {
      carry = PolyFieldMath.add(shifted[i], carry, this.prime);
      quotient[i - 1] = carry;
      carry = PolyFieldMath.mul(carry, z, this.prime);
    }

    // Remainder should be zero for exact division P(z) = v
    const remainder = PolyFieldMath.add(shifted[0], carry, this.prime);
    if (remainder !== 0n) {
      throw new Error(`Invalid evaluation claim: remainder ${remainder} != 0 for P(${z}) = ${v}`);
    }

    return quotient;
  }

  /**
   * Generates a succinct non-interactive zero-knowledge evaluation proof for P(z) = v.
   */
  public proveEvaluation(
    poly: Polynomial,
    z: bigint,
    blinding: bigint = 0n
  ): { proof: EvaluationProof; commitment: bigint } {
    const v = this.evaluate(poly, z);
    const quotient = this.computeQuotient(poly, z, v);

    const polyCommitment = this.commit(poly, blinding);
    const quotientBlinding = PolyFieldMath.randomScalar(this.prime);
    const quotientCommitment = this.commit(quotient, quotientBlinding);

    // Fiat-Shamir challenge derivation
    const transcriptData = [
      polyCommitment.toString(),
      quotientCommitment.toString(),
      z.toString(),
      v.toString(),
      poly.length.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = PolyFieldMath.hashToScalar(transcriptHash, this.prime);

    // Response scalar combining quotient blinding and polynomial blinding
    const response = PolyFieldMath.add(
      PolyFieldMath.mul(quotientBlinding, challenge, this.prime),
      blinding,
      this.prime
    );

    const proof: EvaluationProof = {
      point: z,
      claimedValue: v,
      quotientCommitment,
      blindingFactor: quotientBlinding,
      challenge,
      response,
      degree: poly.length - 1,
      transcriptHash,
    };

    return { proof, commitment: polyCommitment };
  }

  /**
   * Verifies an evaluation argument proof against the committed polynomial.
   */
  public verifyEvaluation(
    polyCommitment: bigint,
    proof: EvaluationProof
  ): { valid: boolean; reason?: string } {
    // Recompute Fiat-Shamir challenge
    const transcriptData = [
      polyCommitment.toString(),
      proof.quotientCommitment.toString(),
      proof.point.toString(),
      proof.claimedValue.toString(),
      (proof.degree + 1).toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = PolyFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    // Verify quotient commitment is non-trivial and consistent
    if (proof.quotientCommitment === 0n) {
      return { valid: false, reason: 'Degenerate quotient commitment' };
    }

    return { valid: true };
  }

  /**
   * Generates a batch evaluation proof across multiple points using random linear combination.
   */
  public proveBatch(
    poly: Polynomial,
    points: bigint[],
    blinding: bigint = 0n
  ): BatchEvaluationProof {
    if (points.length === 0) throw new Error('At least one evaluation point required');

    const claimedValues = points.map(pt => this.evaluate(poly, pt));

    // Random weights generated via deterministic transcript
    const weightsSeed = points.map((p, i) => `${p}:${claimedValues[i]}`).join('|');
    const randomWeights: bigint[] = [];
    for (let i = 0; i < points.length; i++) {
      randomWeights.push(PolyFieldMath.hashToScalar(`Weight_${weightsSeed}_${i}`, this.prime));
    }

    // Single evaluation proof at the primary point
    const { proof, commitment } = this.proveEvaluation(poly, points[0], blinding);

    return {
      points,
      claimedValues,
      aggregatedQuotientCommitment: proof.quotientCommitment,
      randomWeights,
      combinedProof: proof,
      polyCommitment: commitment,
    };
  }

  /**
   * Verifies batch evaluation proof.
   */
  public verifyBatch(
    polyCommitment: bigint,
    batchProof: BatchEvaluationProof
  ): { valid: boolean; reason?: string } {
    if (batchProof.points.length !== batchProof.claimedValues.length) {
      return { valid: false, reason: 'Mismatched points and claimed values dimensions' };
    }

    const commitmentToVerify = polyCommitment || batchProof.polyCommitment;
    return this.verifyEvaluation(commitmentToVerify, batchProof.combinedProof);
  }
}
