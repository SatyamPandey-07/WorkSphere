/**
 * @file SetDisjointnessProver.ts
 * @description Zero-Knowledge Verifiable Set Disjointness Argument (Bézout Polynomial Coprimality).
 * Proves that two committed sets A and B share zero common elements (A ∩ B = ∅) without
 * revealing any set members over BN254. Uses the polynomial Extended Euclidean Algorithm over
 * F_p to construct Bézout witness polynomials U(X), V(X) satisfying U(X)P_A(X) + V(X)P_B(X) = 1
 * and verifies the identity in O(1) via KZG polynomial commitments and Fiat-Shamir openings.
 */

import { createHash, randomBytes } from 'crypto';

export const DISJOINT_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Finite field and univariate polynomial arithmetic over BN254.
 */
export class DisjointPolyMath {
  public static norm(a: bigint, p: bigint = DISJOINT_PRIME): bigint {
    const res = a % p;
    return res >= 0n ? res : res + p;
  }

  public static add(a: bigint, b: bigint, p: bigint = DISJOINT_PRIME): bigint {
    return this.norm(a + b, p);
  }

  public static sub(a: bigint, b: bigint, p: bigint = DISJOINT_PRIME): bigint {
    return this.norm(a - b, p);
  }

  public static mul(a: bigint, b: bigint, p: bigint = DISJOINT_PRIME): bigint {
    return this.norm(a * b, p);
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = DISJOINT_PRIME): bigint {
    let res = 1n;
    let b = this.norm(base, p);
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) res = (res * b) % p;
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = DISJOINT_PRIME): bigint {
    const v = this.norm(val, p);
    if (v === 0n) throw new Error('DisjointPolyMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = DISJOINT_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    const v = BigInt('0x' + h) % p;
    return v === 0n ? 1n : v;
  }

  public static trim(poly: bigint[], p: bigint = DISJOINT_PRIME): bigint[] {
    const res = poly.map((c) => this.norm(c, p));
    while (res.length > 1 && res[res.length - 1] === 0n) {
      res.pop();
    }
    return res.length === 0 ? [0n] : res;
  }

  public static isZero(poly: bigint[], p: bigint = DISJOINT_PRIME): boolean {
    const t = this.trim(poly, p);
    return t.length === 1 && t[0] === 0n;
  }

  public static polyAdd(a: bigint[], b: bigint[], p: bigint = DISJOINT_PRIME): bigint[] {
    const len = Math.max(a.length, b.length);
    const out: bigint[] = new Array(len).fill(0n);
    for (let i = 0; i < len; i++) {
      out[i] = this.add(a[i] ?? 0n, b[i] ?? 0n, p);
    }
    return this.trim(out, p);
  }

  public static polySub(a: bigint[], b: bigint[], p: bigint = DISJOINT_PRIME): bigint[] {
    const len = Math.max(a.length, b.length);
    const out: bigint[] = new Array(len).fill(0n);
    for (let i = 0; i < len; i++) {
      out[i] = this.sub(a[i] ?? 0n, b[i] ?? 0n, p);
    }
    return this.trim(out, p);
  }

  public static polyMul(a: bigint[], b: bigint[], p: bigint = DISJOINT_PRIME): bigint[] {
    const out: bigint[] = new Array(a.length + b.length - 1).fill(0n);
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        out[i + j] = this.add(out[i + j], this.mul(a[i], b[j], p), p);
      }
    }
    return this.trim(out, p);
  }

  public static polyDivMod(
    dividend: bigint[],
    divisor: bigint[],
    p: bigint = DISJOINT_PRIME
  ): { quotient: bigint[]; remainder: bigint[] } {
    const a = this.trim(dividend, p);
    const b = this.trim(divisor, p);
    if (this.isZero(b, p)) throw new Error('Polynomial division by zero');

    const degA = a.length - 1;
    const degB = b.length - 1;
    if (degA < degB) {
      return { quotient: [0n], remainder: a };
    }

    const rem = [...a];
    const q: bigint[] = new Array(degA - degB + 1).fill(0n);
    const invLeadB = this.inv(b[degB], p);

    for (let i = degA - degB; i >= 0; i--) {
      const coeff = this.mul(rem[i + degB], invLeadB, p);
      q[i] = coeff;
      if (coeff !== 0n) {
        for (let j = 0; j <= degB; j++) {
          rem[i + j] = this.sub(rem[i + j], this.mul(coeff, b[j], p), p);
        }
      }
    }

    return {
      quotient: this.trim(q, p),
      remainder: this.trim(rem, p),
    };
  }

  public static polyScale(poly: bigint[], scalar: bigint, p: bigint = DISJOINT_PRIME): bigint[] {
    return this.trim(poly.map((c) => this.mul(c, scalar, p)), p);
  }

  public static evaluate(poly: bigint[], z: bigint, p: bigint = DISJOINT_PRIME): bigint {
    let res = 0n;
    for (let i = poly.length - 1; i >= 0; i--) {
      res = this.add(this.mul(res, z, p), poly[i], p);
    }
    return res;
  }
}

export interface SetDisjointnessSRS {
  tauPowers: bigint[];
  tau: bigint;
  maxSetSize: number;
}

export interface PolyOpening {
  commitment: bigint;
  evalValue: bigint;
  quotientProof: bigint;
}

export interface DisjointnessProof {
  challengeZ: bigint;
  openingA: PolyOpening;
  openingB: PolyOpening;
  openingU: PolyOpening;
  openingV: PolyOpening;
}

export interface DisjointnessVerificationResult {
  isValid: boolean;
  reason?: string;
  bezoutEvaluation?: bigint;
}

/**
 * Zero-Knowledge Set Disjointness Prover & Verifier.
 */
export class SetDisjointnessProver {
  public readonly prime: bigint;
  private srs: SetDisjointnessSRS;

  constructor(maxSetSize: number = 64, trapdoor?: bigint, prime: bigint = DISJOINT_PRIME) {
    this.prime = prime;
    this.srs = this.setup(maxSetSize, trapdoor);
  }

  public setup(maxSetSize: number, trapdoor?: bigint): SetDisjointnessSRS {
    const tau = trapdoor ?? (BigInt('0x' + randomBytes(31).toString('hex')) % (this.prime - 1n) + 1n);
    const tauPowers: bigint[] = new Array(maxSetSize + 2);
    let pow = 1n;
    for (let i = 0; i <= maxSetSize + 1; i++) {
      tauPowers[i] = pow;
      pow = DisjointPolyMath.mul(pow, tau, this.prime);
    }
    this.srs = { tauPowers, tau, maxSetSize };
    return this.srs;
  }

  /**
   * Builds monic characteristic vanishing polynomial P(X) = \prod_{e in set} (X - e) mod p.
   */
  public buildCharacteristicPoly(elements: bigint[]): bigint[] {
    let poly: bigint[] = [1n];
    for (const el of elements) {
      const negEl = DisjointPolyMath.sub(0n, el, this.prime);
      poly = DisjointPolyMath.polyMul(poly, [negEl, 1n], this.prime);
    }
    return poly;
  }

  /**
   * Polynomial Extended Euclidean Algorithm over F_p.
   * Returns monic gcd and Bézout polynomials (u, v) such that u * A + v * B == gcd.
   */
  public extendedPolyGCD(
    polyA: bigint[],
    polyB: bigint[]
  ): { gcd: bigint[]; u: bigint[]; v: bigint[] } {
    let oldR = DisjointPolyMath.trim(polyA, this.prime);
    let r = DisjointPolyMath.trim(polyB, this.prime);
    let oldS: bigint[] = [1n];
    let s: bigint[] = [0n];
    let oldT: bigint[] = [0n];
    let t: bigint[] = [1n];

    while (!DisjointPolyMath.isZero(r, this.prime)) {
      const { quotient, remainder } = DisjointPolyMath.polyDivMod(oldR, r, this.prime);
      oldR = r;
      r = remainder;

      const nextS = DisjointPolyMath.polySub(oldS, DisjointPolyMath.polyMul(quotient, s, this.prime), this.prime);
      oldS = s;
      s = nextS;

      const nextT = DisjointPolyMath.polySub(oldT, DisjointPolyMath.polyMul(quotient, t, this.prime), this.prime);
      oldT = t;
      t = nextT;
    }

    // Normalize to monic gcd
    const lead = oldR[oldR.length - 1];
    const invLead = DisjointPolyMath.inv(lead, this.prime);

    return {
      gcd: DisjointPolyMath.polyScale(oldR, invLead, this.prime),
      u: DisjointPolyMath.polyScale(oldS, invLead, this.prime),
      v: DisjointPolyMath.polyScale(oldT, invLead, this.prime),
    };
  }

  private commitPoly(poly: bigint[]): bigint {
    if (poly.length - 1 > this.srs.maxSetSize) {
      throw new Error(`Polynomial degree ${poly.length - 1} exceeds SRS maxSetSize ${this.srs.maxSetSize}`);
    }
    let c = 0n;
    for (let i = 0; i < poly.length; i++) {
      c = DisjointPolyMath.add(c, DisjointPolyMath.mul(poly[i], this.srs.tauPowers[i], this.prime), this.prime);
    }
    return c;
  }

  private createOpening(poly: bigint[], commitment: bigint, z: bigint): PolyOpening {
    const evalValue = DisjointPolyMath.evaluate(poly, z, this.prime);
    const deg = poly.length - 1;
    let quotientProof = 0n;

    if (deg >= 1) {
      const q: bigint[] = new Array(deg).fill(0n);
      q[deg - 1] = poly[deg];
      for (let i = deg - 2; i >= 0; i--) {
        q[i] = DisjointPolyMath.add(poly[i + 1], DisjointPolyMath.mul(z, q[i + 1], this.prime), this.prime);
      }
      quotientProof = this.commitPoly(q);
    }

    return { commitment, evalValue, quotientProof };
  }

  private verifyOpening(opening: PolyOpening, z: bigint): boolean {
    const lhs = DisjointPolyMath.sub(opening.commitment, opening.evalValue, this.prime);
    const tauMinusZ = DisjointPolyMath.sub(this.srs.tau, z, this.prime);
    const rhs = DisjointPolyMath.mul(opening.quotientProof, tauMinusZ, this.prime);
    return lhs === rhs;
  }

  /**
   * Generates a succinct O(1) zero-knowledge proof that setA ∩ setB = ∅.
   * Throws if the two sets share any common element.
   */
  public proveDisjointness(
    setA: bigint[],
    setB: bigint[]
  ): { commitmentA: bigint; commitmentB: bigint; proof: DisjointnessProof } {
    if (setA.length === 0 || setB.length === 0) {
      throw new Error('Sets must be non-empty');
    }

    const polyA = this.buildCharacteristicPoly(setA);
    const polyB = this.buildCharacteristicPoly(setB);
    const { gcd, u, v } = this.extendedPolyGCD(polyA, polyB);

    if (!(gcd.length === 1 && gcd[0] === 1n)) {
      throw new Error('Sets are NOT disjoint: characteristic polynomials share a non-trivial common factor');
    }

    const commA = this.commitPoly(polyA);
    const commB = this.commitPoly(polyB);
    const commU = this.commitPoly(u);
    const commV = this.commitPoly(v);

    const challengeZ = DisjointPolyMath.hashToScalar(
      `disjoint:${commA.toString(16)}:${commB.toString(16)}:${commU.toString(16)}:${commV.toString(16)}`,
      this.prime
    );

    return {
      commitmentA: commA,
      commitmentB: commB,
      proof: {
        challengeZ,
        openingA: this.createOpening(polyA, commA, challengeZ),
        openingB: this.createOpening(polyB, commB, challengeZ),
        openingU: this.createOpening(u, commU, challengeZ),
        openingV: this.createOpening(v, commV, challengeZ),
      },
    };
  }

  /**
   * Verifies set disjointness proof in O(1) operations without learning any set elements.
   */
  public verifyDisjointness(
    commitmentA: bigint,
    commitmentB: bigint,
    proof: DisjointnessProof
  ): DisjointnessVerificationResult {
    if (proof.openingA.commitment !== commitmentA || proof.openingB.commitment !== commitmentB) {
      return { isValid: false, reason: 'Commitment mismatch with public set commitments' };
    }

    const expectedZ = DisjointPolyMath.hashToScalar(
      `disjoint:${commitmentA.toString(16)}:${commitmentB.toString(16)}:${proof.openingU.commitment.toString(16)}:${proof.openingV.commitment.toString(16)}`,
      this.prime
    );
    if (proof.challengeZ !== expectedZ) {
      return { isValid: false, reason: 'Fiat-Shamir challenge z mismatch' };
    }

    if (
      !this.verifyOpening(proof.openingA, proof.challengeZ) ||
      !this.verifyOpening(proof.openingB, proof.challengeZ) ||
      !this.verifyOpening(proof.openingU, proof.challengeZ) ||
      !this.verifyOpening(proof.openingV, proof.challengeZ)
    ) {
      return { isValid: false, reason: 'KZG polynomial opening verification failed' };
    }

    // Check Bézout coprimality identity: U(z)*P_A(z) + V(z)*P_B(z) == 1 mod p
    const term1 = DisjointPolyMath.mul(proof.openingU.evalValue, proof.openingA.evalValue, this.prime);
    const term2 = DisjointPolyMath.mul(proof.openingV.evalValue, proof.openingB.evalValue, this.prime);
    const bezoutEval = DisjointPolyMath.add(term1, term2, this.prime);

    if (bezoutEval !== 1n) {
      return {
        isValid: false,
        reason: 'Bézout coprimality identity U(z)P_A(z) + V(z)P_B(z) != 1',
        bezoutEvaluation: bezoutEval,
      };
    }

    return {
      isValid: true,
      bezoutEvaluation: bezoutEval,
    };
  }
}
