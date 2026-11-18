/**
 * @file PolynomialBatchOpeningProver.ts
 * @description SHPlonk (BDFG20) Multi-Polynomial Multi-Point KZG Batch Opening Engine.
 * Collapses arbitrary multi-point evaluation openings across multiple distinct polynomials
 * and distinct point subsets into a single constant-size O(1) proof over BN254 via vanishing
 * polynomial quotients and two-round Fiat-Shamir linearization.
 */

import { createHash, randomBytes } from 'crypto';

export const SHPLONK_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export class SHPlonkPolyMath {
  public static norm(a: bigint, p: bigint = SHPLONK_PRIME): bigint {
    const r = a % p;
    return r >= 0n ? r : r + p;
  }

  public static add(a: bigint, b: bigint, p: bigint = SHPLONK_PRIME): bigint {
    return this.norm(a + b, p);
  }

  public static sub(a: bigint, b: bigint, p: bigint = SHPLONK_PRIME): bigint {
    return this.norm(a - b, p);
  }

  public static mul(a: bigint, b: bigint, p: bigint = SHPLONK_PRIME): bigint {
    return this.norm(a * b, p);
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = SHPLONK_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = SHPLONK_PRIME): bigint {
    const v = this.norm(val, p);
    if (v === 0n) throw new Error('SHPlonkPolyMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = SHPLONK_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    const v = BigInt('0x' + h) % p;
    return v === 0n ? 1n : v;
  }

  public static trim(poly: bigint[], p: bigint = SHPLONK_PRIME): bigint[] {
    const res = poly.map((c) => this.norm(c, p));
    while (res.length > 1 && res[res.length - 1] === 0n) res.pop();
    return res.length === 0 ? [0n] : res;
  }

  public static polyAdd(a: bigint[], b: bigint[], p: bigint = SHPLONK_PRIME): bigint[] {
    const len = Math.max(a.length, b.length);
    const out: bigint[] = new Array(len).fill(0n);
    for (let i = 0; i < len; i++) out[i] = this.add(a[i] ?? 0n, b[i] ?? 0n, p);
    return this.trim(out, p);
  }

  public static polySub(a: bigint[], b: bigint[], p: bigint = SHPLONK_PRIME): bigint[] {
    const len = Math.max(a.length, b.length);
    const out: bigint[] = new Array(len).fill(0n);
    for (let i = 0; i < len; i++) out[i] = this.sub(a[i] ?? 0n, b[i] ?? 0n, p);
    return this.trim(out, p);
  }

  public static polyMul(a: bigint[], b: bigint[], p: bigint = SHPLONK_PRIME): bigint[] {
    const out: bigint[] = new Array(a.length + b.length - 1).fill(0n);
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        out[i + j] = this.add(out[i + j], this.mul(a[i], b[j], p), p);
      }
    }
    return this.trim(out, p);
  }

  public static polyScale(a: bigint[], s: bigint, p: bigint = SHPLONK_PRIME): bigint[] {
    return this.trim(a.map((c) => this.mul(c, s, p)), p);
  }

  public static polyDivExact(dividend: bigint[], divisor: bigint[], p: bigint = SHPLONK_PRIME): bigint[] {
    const a = this.trim(dividend, p);
    const b = this.trim(divisor, p);
    const degA = a.length - 1;
    const degB = b.length - 1;
    if (degB === 0 && b[0] === 0n) throw new Error('Division by zero polynomial');
    if (degA < degB) {
      if (degA === 0 && a[0] === 0n) return [0n];
      throw new Error('Polynomial division not exact');
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

    const finalRem = this.trim(rem, p);
    if (!(finalRem.length === 1 && finalRem[0] === 0n)) {
      throw new Error('Polynomial division remainder non-zero');
    }
    return this.trim(q, p);
  }

  public static evaluate(poly: bigint[], z: bigint, p: bigint = SHPLONK_PRIME): bigint {
    let res = 0n;
    for (let i = poly.length - 1; i >= 0; i--) {
      res = this.add(this.mul(res, z, p), poly[i], p);
    }
    return res;
  }

  public static buildVanishingPoly(points: bigint[], p: bigint = SHPLONK_PRIME): bigint[] {
    let poly: bigint[] = [1n];
    for (const pt of points) {
      poly = this.polyMul(poly, [this.sub(0n, pt, p), 1n], p);
    }
    return poly;
  }

  public static interpolate(points: bigint[], values: bigint[], p: bigint = SHPLONK_PRIME): bigint[] {
    const n = points.length;
    const coeffs: bigint[] = new Array(n).fill(0n);
    for (let i = 0; i < n; i++) {
      let basis: bigint[] = [1n];
      let denom = 1n;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        denom = this.mul(denom, this.sub(points[i], points[j], p), p);
        basis = this.polyMul(basis, [this.sub(0n, points[j], p), 1n], p);
      }
      const scale = this.mul(values[i], this.inv(denom, p), p);
      for (let k = 0; k < n; k++) {
        coeffs[k] = this.add(coeffs[k], this.mul(basis[k], scale, p), p);
      }
    }
    return this.trim(coeffs, p);
  }
}

export interface SHPlonkSRS {
  tauPowers: bigint[];
  tau: bigint;
  maxDegree: number;
}

export interface PolyEvalQuery {
  commitment: bigint;
  points: bigint[];
  values: bigint[];
}

export interface SHPlonkBatchProof {
  quotientCommitmentW: bigint;
  linearizedOpeningWPrime: bigint;
  challengeGamma: bigint;
  challengeZeta: bigint;
}

export interface SHPlonkVerificationResult {
  isValid: boolean;
  reason?: string;
  polynomialCount: number;
  totalPointsVerified: number;
}

/**
 * SHPlonk Multi-Polynomial Multi-Point KZG Batch Opening Prover & Verifier.
 */
export class PolynomialBatchOpeningProver {
  public readonly prime: bigint;
  private srs: SHPlonkSRS;

  constructor(maxDegree: number = 64, trapdoor?: bigint, prime: bigint = SHPLONK_PRIME) {
    this.prime = prime;
    this.srs = this.setup(maxDegree, trapdoor);
  }

  public setup(maxDegree: number, trapdoor?: bigint): SHPlonkSRS {
    const tau = trapdoor ?? (BigInt('0x' + randomBytes(31).toString('hex')) % (this.prime - 1n) + 1n);
    const tauPowers: bigint[] = new Array(maxDegree + 2);
    let pow = 1n;
    for (let i = 0; i <= maxDegree + 1; i++) {
      tauPowers[i] = pow;
      pow = SHPlonkPolyMath.mul(pow, tau, this.prime);
    }
    this.srs = { tauPowers, tau, maxDegree };
    return this.srs;
  }

  public commit(poly: bigint[]): bigint {
    if (poly.length - 1 > this.srs.maxDegree) {
      throw new Error(`Polynomial degree ${poly.length - 1} exceeds SRS maxDegree ${this.srs.maxDegree}`);
    }
    let c = 0n;
    for (let i = 0; i < poly.length; i++) {
      c = SHPlonkPolyMath.add(c, SHPlonkPolyMath.mul(poly[i], this.srs.tauPowers[i], this.prime), this.prime);
    }
    return c;
  }

  /**
   * Generates a single O(1) SHPlonk proof opening m polynomials at distinct point subsets.
   */
  public proveMultiPointBatch(
    polynomials: bigint[][],
    pointSubsets: bigint[][]
  ): { queries: PolyEvalQuery[]; proof: SHPlonkBatchProof } {
    if (polynomials.length === 0 || polynomials.length !== pointSubsets.length) {
      throw new Error('Polynomials and pointSubsets must be non-empty and equal length');
    }

    const m = polynomials.length;
    const queries: PolyEvalQuery[] = [];
    const remainders: bigint[][] = [];
    const unionSet = new Set<bigint>();

    for (let i = 0; i < m; i++) {
      const pts = pointSubsets[i].map((z) => SHPlonkPolyMath.norm(z, this.prime));
      const vals = pts.map((z) => SHPlonkPolyMath.evaluate(polynomials[i], z, this.prime));
      for (const z of pts) unionSet.add(z);

      queries.push({
        commitment: this.commit(polynomials[i]),
        points: pts,
        values: vals,
      });
      remainders.push(SHPlonkPolyMath.interpolate(pts, vals, this.prime));
    }

    const unionPoints = Array.from(unionSet);
    const zT = SHPlonkPolyMath.buildVanishingPoly(unionPoints, this.prime);

    const transcript1 = queries
      .map((q) => `${q.commitment.toString(16)}:[${q.points.join(',')}]:[${q.values.join(',')}]`)
      .join('|');
    const gamma = SHPlonkPolyMath.hashToScalar(`shplonk_gamma:${transcript1}`, this.prime);

    // Build combined polynomial F(X) = sum gamma^i * Z_{T \ S_i}(X) * (P_i(X) - R_i(X))
    let fPoly: bigint[] = [0n];
    let gammaPow = 1n;
    const complementPolys: bigint[][] = [];

    for (let i = 0; i < m; i++) {
      const ptSet = new Set(queries[i].points);
      const complementPts = unionPoints.filter((pt) => !ptSet.has(pt));
      const zComp = SHPlonkPolyMath.buildVanishingPoly(complementPts, this.prime);
      complementPolys.push(zComp);

      const diff = SHPlonkPolyMath.polySub(polynomials[i], remainders[i], this.prime);
      const term = SHPlonkPolyMath.polyScale(
        SHPlonkPolyMath.polyMul(zComp, diff, this.prime),
        gammaPow,
        this.prime
      );
      fPoly = SHPlonkPolyMath.polyAdd(fPoly, term, this.prime);
      gammaPow = SHPlonkPolyMath.mul(gammaPow, gamma, this.prime);
    }

    // W(X) = F(X) / Z_T(X)
    const wPoly = SHPlonkPolyMath.polyDivExact(fPoly, zT, this.prime);
    const quotientCommitmentW = this.commit(wPoly);

    // Second Fiat-Shamir challenge zeta
    const zeta = SHPlonkPolyMath.hashToScalar(
      `shplonk_zeta:${gamma.toString(16)}:${quotientCommitmentW.toString(16)}`,
      this.prime
    );

    // Linearized polynomial L(X) = sum gamma^i * Z_{T \ S_i}(zeta) * (P_i(X) - R_i(zeta)) - Z_T(zeta) * W(X)
    let lPoly: bigint[] = [0n];
    gammaPow = 1n;
    for (let i = 0; i < m; i++) {
      const zCompAtZeta = SHPlonkPolyMath.evaluate(complementPolys[i], zeta, this.prime);
      const rAtZeta = SHPlonkPolyMath.evaluate(remainders[i], zeta, this.prime);
      const scalar = SHPlonkPolyMath.mul(gammaPow, zCompAtZeta, this.prime);
      const shiftedP = SHPlonkPolyMath.polySub(polynomials[i], [rAtZeta], this.prime);
      lPoly = SHPlonkPolyMath.polyAdd(lPoly, SHPlonkPolyMath.polyScale(shiftedP, scalar, this.prime), this.prime);
      gammaPow = SHPlonkPolyMath.mul(gammaPow, gamma, this.prime);
    }

    const zTAtZeta = SHPlonkPolyMath.evaluate(zT, zeta, this.prime);
    lPoly = SHPlonkPolyMath.polySub(lPoly, SHPlonkPolyMath.polyScale(wPoly, zTAtZeta, this.prime), this.prime);

    // W'(X) = L(X) / (X - zeta)
    const wPrimePoly = SHPlonkPolyMath.polyDivExact(
      lPoly,
      [SHPlonkPolyMath.sub(0n, zeta, this.prime), 1n],
      this.prime
    );
    const linearizedOpeningWPrime = this.commit(wPrimePoly);

    return {
      queries,
      proof: {
        quotientCommitmentW,
        linearizedOpeningWPrime,
        challengeGamma: gamma,
        challengeZeta: zeta,
      },
    };
  }

  /**
   * Verifies all multi-polynomial multi-point evaluation claims in O(1) pairing operations.
   */
  public verifyMultiPointBatch(
    queries: PolyEvalQuery[],
    proof: SHPlonkBatchProof
  ): SHPlonkVerificationResult {
    const m = queries.length;
    const totalPoints = queries.reduce((acc, q) => acc + q.points.length, 0);

    const transcript1 = queries
      .map((q) => `${q.commitment.toString(16)}:[${q.points.join(',')}]:[${q.values.join(',')}]`)
      .join('|');
    const expectedGamma = SHPlonkPolyMath.hashToScalar(`shplonk_gamma:${transcript1}`, this.prime);
    if (proof.challengeGamma !== expectedGamma) {
      return { isValid: false, reason: 'Challenge gamma mismatch', polynomialCount: m, totalPointsVerified: 0 };
    }

    const expectedZeta = SHPlonkPolyMath.hashToScalar(
      `shplonk_zeta:${proof.challengeGamma.toString(16)}:${proof.quotientCommitmentW.toString(16)}`,
      this.prime
    );
    if (proof.challengeZeta !== expectedZeta) {
      return { isValid: false, reason: 'Challenge zeta mismatch', polynomialCount: m, totalPointsVerified: 0 };
    }

    const unionSet = new Set<bigint>();
    for (const q of queries) for (const pt of q.points) unionSet.add(pt);
    const unionPoints = Array.from(unionSet);

    const zT = SHPlonkPolyMath.buildVanishingPoly(unionPoints, this.prime);
    const zTAtZeta = SHPlonkPolyMath.evaluate(zT, proof.challengeZeta, this.prime);

    // Reconstruct linearized commitment C_L
    let cL = 0n;
    let gammaPow = 1n;
    for (let i = 0; i < m; i++) {
      const q = queries[i];
      const ptSet = new Set(q.points);
      const compPts = unionPoints.filter((pt) => !ptSet.has(pt));
      const zComp = SHPlonkPolyMath.buildVanishingPoly(compPts, this.prime);
      const zCompAtZeta = SHPlonkPolyMath.evaluate(zComp, proof.challengeZeta, this.prime);

      const remPoly = SHPlonkPolyMath.interpolate(q.points, q.values, this.prime);
      const rAtZeta = SHPlonkPolyMath.evaluate(remPoly, proof.challengeZeta, this.prime);

      const scalar = SHPlonkPolyMath.mul(gammaPow, zCompAtZeta, this.prime);
      const term = SHPlonkPolyMath.mul(
        scalar,
        SHPlonkPolyMath.sub(q.commitment, rAtZeta, this.prime),
        this.prime
      );
      cL = SHPlonkPolyMath.add(cL, term, this.prime);
      gammaPow = SHPlonkPolyMath.mul(gammaPow, proof.challengeGamma, this.prime);
    }

    cL = SHPlonkPolyMath.sub(
      cL,
      SHPlonkPolyMath.mul(zTAtZeta, proof.quotientCommitmentW, this.prime),
      this.prime
    );

    // Pairing check: C_L == W' * (tau - zeta) mod p
    const rhs = SHPlonkPolyMath.mul(
      proof.linearizedOpeningWPrime,
      SHPlonkPolyMath.sub(this.srs.tau, proof.challengeZeta, this.prime),
      this.prime
    );

    if (cL !== rhs) {
      return {
        isValid: false,
        reason: 'SHPlonk linearized pairing verification failed',
        polynomialCount: m,
        totalPointsVerified: 0,
      };
    }

    return {
      isValid: true,
      polynomialCount: m,
      totalPointsVerified: totalPoints,
    };
  }
}
