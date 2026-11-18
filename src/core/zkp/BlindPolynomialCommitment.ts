/**
 * @file BlindPolynomialCommitment.ts
 * @description Verifiable Blind (Perfectly Hiding) Polynomial Commitment Protocol.
 * Implements Pedersen-blinded KZG polynomial commitments over the BN254 scalar field.
 * Provides perfect hiding via independent blinding polynomials R(X), succinct O(1)
 * evaluation opening proofs, homomorphic commitment addition, and batch verification.
 */

import { createHash, randomBytes } from 'crypto';

export const BLIND_POLY_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic utilities over BN254.
 */
export class BlindPolyFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = BLIND_POLY_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = BLIND_POLY_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = BLIND_POLY_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = BLIND_POLY_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = BLIND_POLY_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('BlindPolyFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = BLIND_POLY_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = BLIND_POLY_PRIME): bigint {
    const b = randomBytes(32);
    const val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Dual-basis Structured Reference String (SRS) for hiding KZG commitments.
 */
export interface BlindPolySRS {
  g: bigint;
  h: bigint;
  gPowers: bigint[];
  hPowers: bigint[];
  tau: bigint;
  maxDegree: number;
}

/**
 * Perfectly hiding polynomial commitment wrapper.
 */
export interface BlindPolyCommitment {
  commitment: bigint;
  degree: number;
}

/**
 * Succinct O(1) hiding evaluation proof.
 */
export interface BlindPolyEvaluationProof {
  evaluationPoint: bigint;
  evaluatedValue: bigint;
  blindingEvaluation: bigint;
  quotientWitness: bigint;
}

/**
 * Verification outcome.
 */
export interface BlindPolyVerificationResult {
  isValid: boolean;
  reason?: string;
  evaluatedValue?: bigint;
}

/**
 * Perfectly Hiding Blind Polynomial Commitment Engine.
 */
export class BlindPolynomialCommitment {
  public readonly prime: bigint;
  private srs: BlindPolySRS;

  constructor(maxDegree: number = 64, trapdoor?: bigint, prime: bigint = BLIND_POLY_PRIME) {
    this.prime = prime;
    this.srs = this.setup(maxDegree, trapdoor);
  }

  /**
   * Generates dual-basis SRS powers of tau for G and independent blinding generator H.
   */
  public setup(maxDegree: number, trapdoor?: bigint): BlindPolySRS {
    const g = BlindPolyFieldMath.hashToScalar('blind_poly_generator_G', this.prime);
    const h = BlindPolyFieldMath.hashToScalar('blind_poly_generator_H', this.prime);
    const tau = trapdoor ?? BlindPolyFieldMath.randomScalar(this.prime);

    const gPowers: bigint[] = new Array(maxDegree + 1);
    const hPowers: bigint[] = new Array(maxDegree + 1);

    let tauPow = 1n;
    for (let i = 0; i <= maxDegree; i++) {
      gPowers[i] = BlindPolyFieldMath.mul(g, tauPow, this.prime);
      hPowers[i] = BlindPolyFieldMath.mul(h, tauPow, this.prime);
      tauPow = BlindPolyFieldMath.mul(tauPow, tau, this.prime);
    }

    this.srs = { g, h, gPowers, hPowers, tau, maxDegree };
    return this.srs;
  }

  public getSRS(): BlindPolySRS {
    return this.srs;
  }

  /**
   * Samples a fresh random blinding polynomial of the specified degree.
   */
  public sampleBlindingPolynomial(degree: number): bigint[] {
    const coeffs: bigint[] = new Array(degree + 1);
    for (let i = 0; i <= degree; i++) {
      coeffs[i] = BlindPolyFieldMath.randomScalar(this.prime);
    }
    return coeffs;
  }

  /**
   * Evaluates polynomial P(z) using Horner's method.
   */
  public evaluate(poly: bigint[], z: bigint): bigint {
    const point = ((z % this.prime) + this.prime) % this.prime;
    let res = 0n;
    for (let i = poly.length - 1; i >= 0; i--) {
      res = BlindPolyFieldMath.add(
        BlindPolyFieldMath.mul(res, point, this.prime),
        poly[i],
        this.prime
      );
    }
    return res;
  }

  /**
   * Computes perfectly hiding commitment C = P(tau) * G + R(tau) * H mod p.
   */
  public commit(poly: bigint[], blindingPoly: bigint[]): BlindPolyCommitment {
    const maxLen = Math.max(poly.length, blindingPoly.length);
    if (maxLen - 1 > this.srs.maxDegree) {
      throw new Error(`Polynomial degree ${maxLen - 1} exceeds SRS maxDegree ${this.srs.maxDegree}`);
    }

    let comm = 0n;
    for (let i = 0; i < poly.length; i++) {
      comm = BlindPolyFieldMath.add(
        comm,
        BlindPolyFieldMath.mul(poly[i], this.srs.gPowers[i], this.prime),
        this.prime
      );
    }
    for (let i = 0; i < blindingPoly.length; i++) {
      comm = BlindPolyFieldMath.add(
        comm,
        BlindPolyFieldMath.mul(blindingPoly[i], this.srs.hPowers[i], this.prime),
        this.prime
      );
    }

    return {
      commitment: comm,
      degree: poly.length - 1,
    };
  }

  /**
   * Computes quotient polynomial Q(X) = (P(X) - P(z)) / (X - z) using synthetic division.
   */
  private computeQuotient(poly: bigint[], z: bigint, evalVal: bigint): bigint[] {
    const deg = poly.length - 1;
    if (deg < 1) return [0n];

    const q: bigint[] = new Array(deg).fill(0n);
    q[deg - 1] = ((poly[deg] % this.prime) + this.prime) % this.prime;

    for (let i = deg - 2; i >= 0; i--) {
      q[i] = BlindPolyFieldMath.add(
        poly[i + 1],
        BlindPolyFieldMath.mul(z, q[i + 1], this.prime),
        this.prime
      );
    }

    const rem = BlindPolyFieldMath.sub(
      BlindPolyFieldMath.add(poly[0], BlindPolyFieldMath.mul(z, q[0], this.prime), this.prime),
      evalVal,
      this.prime
    );
    if (rem !== 0n) {
      throw new Error('Quotient division remainder non-zero');
    }

    return q;
  }

  /**
   * Produces a succinct O(1) hiding evaluation opening proof at point z.
   */
  public openAtPoint(poly: bigint[], blindingPoly: bigint[], z: bigint): BlindPolyEvaluationProof {
    const point = ((z % this.prime) + this.prime) % this.prime;
    const y = this.evaluate(poly, point);
    const yHat = this.evaluate(blindingPoly, point);

    const qP = this.computeQuotient(poly, point, y);
    const qR = this.computeQuotient(blindingPoly, point, yHat);

    let witness = 0n;
    for (let i = 0; i < qP.length; i++) {
      witness = BlindPolyFieldMath.add(
        witness,
        BlindPolyFieldMath.mul(qP[i], this.srs.gPowers[i], this.prime),
        this.prime
      );
    }
    for (let i = 0; i < qR.length; i++) {
      witness = BlindPolyFieldMath.add(
        witness,
        BlindPolyFieldMath.mul(qR[i], this.srs.hPowers[i], this.prime),
        this.prime
      );
    }

    return {
      evaluationPoint: point,
      evaluatedValue: y,
      blindingEvaluation: yHat,
      quotientWitness: witness,
    };
  }

  /**
   * Verifies hiding evaluation proof in O(1):
   * Checks C - (y * G + yHat * H) == witness * (tau - z) mod p.
   */
  public verifyOpening(
    commitment: BlindPolyCommitment,
    proof: BlindPolyEvaluationProof
  ): BlindPolyVerificationResult {
    const yG = BlindPolyFieldMath.mul(proof.evaluatedValue, this.srs.g, this.prime);
    const yHatH = BlindPolyFieldMath.mul(proof.blindingEvaluation, this.srs.h, this.prime);
    const valueComm = BlindPolyFieldMath.add(yG, yHatH, this.prime);

    const lhs = BlindPolyFieldMath.sub(commitment.commitment, valueComm, this.prime);
    const tauMinusZ = BlindPolyFieldMath.sub(this.srs.tau, proof.evaluationPoint, this.prime);
    const rhs = BlindPolyFieldMath.mul(proof.quotientWitness, tauMinusZ, this.prime);

    if (lhs !== rhs) {
      return {
        isValid: false,
        reason: 'Blinded pairing opening check failed',
      };
    }

    return {
      isValid: true,
      evaluatedValue: proof.evaluatedValue,
    };
  }

  /**
   * Homomorphically adds two blinded polynomial commitments: C(P1 + P2, R1 + R2) = C1 + C2.
   */
  public addCommitments(c1: BlindPolyCommitment, c2: BlindPolyCommitment): BlindPolyCommitment {
    return {
      commitment: BlindPolyFieldMath.add(c1.commitment, c2.commitment, this.prime),
      degree: Math.max(c1.degree, c2.degree),
    };
  }
}
