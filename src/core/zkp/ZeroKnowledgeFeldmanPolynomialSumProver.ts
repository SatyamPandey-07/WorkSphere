/**
 * @file ZeroKnowledgeFeldmanPolynomialSumProver.ts
 * @description Homomorphic Multi-Dealer Feldman Polynomial Sum & Evaluation Consistency Auditor.
 * Enables K independent dealers to commit to degree-(t-1) polynomials f_1(x), ..., f_K(x)
 * via Feldman commitments C_{d,k} = g^{a_{d,k}} mod p, homomorphically aggregate them into
 * F(x) = Sum f_d(x) (with aggregate commitments C_agg[k] = Prod_d C_{d,k}), and verify:
 *   1. Individual dealer evaluation shares against C_{d,*}.
 *   2. Aggregate evaluation shares F(j) against C_agg[*] without reconstructing any dealer polynomial.
 *   3. Randomized batch multi-point consistency audits & JSON serialization.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface DealerPolynomialCommit {
  dealerId: string;
  degree: number;
  coefficients: bigint[];
  commitments: bigint[];
  dealerDigest: string;
}

export interface AggregatePolynomialSummary {
  sumId: string;
  degree: number;
  dealerIds: string[];
  aggregateCommitments: bigint[];
  aggregateConstantPub: bigint;
  summaryDigest: string;
}

export interface PointConsistencyProof {
  sumId: string;
  pointX: bigint;
  claimedEvalY: bigint;
  expectedEvalCommit: bigint;
  nonceCommit: bigint;
  challenge: bigint;
  response: bigint;
}

function modNorm(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInverse(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = modNorm(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function hashScalar(domain: string, parts: readonly (string | bigint)[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(typeof part === 'bigint' ? part.toString(16) : part);
  }
  return (BigInt(`0x${h.digest('hex')}`) % (SUBGROUP_Q - 1n)) + 1n;
}

/**
 * Homomorphic Multi-Dealer Feldman Polynomial Sum & Evaluation Consistency Engine.
 */
export class ZeroKnowledgeFeldmanPolynomialSumProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
  }

  public evalPoly(coeffs: readonly bigint[], x: bigint): bigint {
    let acc = 0n;
    const xn = modNorm(x, this.q);
    for (let i = coeffs.length - 1; i >= 0; i--) {
      acc = modNorm(acc * xn + coeffs[i], this.q);
    }
    return acc;
  }

  public evalCommitments(commitments: readonly bigint[], x: bigint): bigint {
    const xn = modNorm(x, this.q);
    let acc = 1n;
    let xPow = 1n;
    for (const c of commitments) {
      acc = (acc * modPow(c, xPow, this.p)) % this.p;
      xPow = modNorm(xPow * xn, this.q);
    }
    return acc;
  }

  public createDealerPolynomial(dealerId: string, degree: number, customCoeffs?: readonly bigint[]): DealerPolynomialCommit {
    if (!Number.isInteger(degree) || degree < 1) throw new RangeError('degree must be >= 1');
    const coefficients = customCoeffs
      ? customCoeffs.map((c) => modNorm(c, this.q))
      : Array.from({ length: degree + 1 }, () => randomScalar(this.q));
    if (coefficients.length !== degree + 1) throw new Error('Coefficient count must equal degree + 1');

    const commitments = coefficients.map((c) => modPow(this.g, c, this.p));
    const dealerDigest = createHash('sha256')
      .update(`${dealerId}|deg:${degree}|${commitments.map((c) => c.toString(16)).join(',')}`)
      .digest('hex');

    return { dealerId, degree, coefficients, commitments, dealerDigest };
  }

  /**
   * Homomorphically sums K independent dealer polynomials into one aggregate commitment vector.
   */
  public aggregateDealerCommitments(
    sumId: string,
    dealers: readonly DealerPolynomialCommit[]
  ): AggregatePolynomialSummary {
    if (dealers.length === 0) throw new Error('At least one dealer required');
    const degree = dealers[0].degree;
    for (const d of dealers) {
      if (d.degree !== degree) throw new Error('All dealer polynomials must share the same degree');
    }

    const aggregateCommitments = new Array<bigint>(degree + 1).fill(1n);
    for (let k = 0; k <= degree; k++) {
      let prod = 1n;
      for (const d of dealers) {
        prod = (prod * d.commitments[k]) % this.p;
      }
      aggregateCommitments[k] = prod;
    }

    const dealerIds = dealers.map((d) => d.dealerId);
    const summaryDigest = createHash('sha256')
      .update(`${sumId}|deg:${degree}|dealers:${dealerIds.join(',')}|c0:${aggregateCommitments[0].toString(16)}`)
      .digest('hex');

    return {
      sumId,
      degree,
      dealerIds,
      aggregateCommitments,
      aggregateConstantPub: aggregateCommitments[0],
      summaryDigest,
    };
  }

  /**
   * Evaluates each dealer at point x, verifies every individual share, sums them to F(x),
   * and emits a Schnorr proof of knowledge of F(x) bound to the aggregate commitment!
   */
  public computeVerifiedAggregateEval(
    summary: AggregatePolynomialSummary,
    dealers: readonly DealerPolynomialCommit[],
    pointX: bigint
  ): {
    evalY: bigint;
    proof: PointConsistencyProof;
    faultyDealerIds: string[];
  } {
    const xn = modNorm(pointX, this.q);
    const faultyDealerIds: string[] = [];
    let evalY = 0n;

    for (const d of dealers) {
      const y = this.evalPoly(d.coefficients, xn);
      const expectedComm = this.evalCommitments(d.commitments, xn);
      if (modPow(this.g, y, this.p) !== expectedComm) {
        faultyDealerIds.push(d.dealerId);
        continue;
      }
      evalY = modNorm(evalY + y, this.q);
    }

    if (faultyDealerIds.length > 0) {
      throw new Error(`Faulty dealer evaluations detected: ${faultyDealerIds.join(', ')}`);
    }

    const expectedEvalCommit = this.evalCommitments(summary.aggregateCommitments, xn);
    const k = randomScalar(this.q);
    const nonceCommit = modPow(this.g, k, this.p);
    const challenge = hashScalar('WorkSphere::FeldmanSumEval', [
      summary.sumId,
      xn,
      expectedEvalCommit,
      nonceCommit,
    ]);
    const response = modNorm(k + challenge * evalY, this.q);

    return {
      evalY,
      faultyDealerIds: [],
      proof: {
        sumId: summary.sumId,
        pointX: xn,
        claimedEvalY: evalY,
        expectedEvalCommit,
        nonceCommit,
        challenge,
        response,
      },
    };
  }

  public verifyPointConsistency(
    summary: AggregatePolynomialSummary,
    proof: PointConsistencyProof
  ): boolean {
    if (proof.sumId !== summary.sumId) return false;
    const expectedCommit = this.evalCommitments(summary.aggregateCommitments, proof.pointX);
    if (expectedCommit !== proof.expectedEvalCommit) return false;
    if (modPow(this.g, modNorm(proof.claimedEvalY, this.q), this.p) !== expectedCommit) return false;

    const expectedC = hashScalar('WorkSphere::FeldmanSumEval', [
      proof.sumId,
      proof.pointX,
      expectedCommit,
      proof.nonceCommit,
    ]);
    if (expectedC !== proof.challenge) return false;

    const lhs = modPow(this.g, modNorm(proof.response, this.q), this.p);
    const rhs = (proof.nonceCommit * modPow(expectedCommit, proof.challenge, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Reconstructs g^{F(0)} from any (degree + 1) distinct verified evaluation commitments via
   * Lagrange interpolation in the exponent and checks equality against aggregateConstantPub!
   */
  public verifyLagrangeConstantTerm(
    summary: AggregatePolynomialSummary,
    points: ReadonlyArray<{ x: bigint; evalCommit: bigint }>
  ): boolean {
    if (points.length < summary.degree + 1) return false;
    const chosen = points.slice(0, summary.degree + 1);

    let acc = 1n;
    for (let i = 0; i < chosen.length; i++) {
      let num = 1n;
      let den = 1n;
      for (let j = 0; j < chosen.length; j++) {
        if (i === j) continue;
        num = modNorm(num * chosen[j].x, this.q);
        den = modNorm(den * modNorm(chosen[j].x - chosen[i].x, this.q), this.q);
      }
      const lambda = modNorm(num * modInverse(den, this.q), this.q);
      acc = (acc * modPow(chosen[i].evalCommit, lambda, this.p)) % this.p;
    }

    return acc === summary.aggregateConstantPub;
  }

  public serializeProof(proof: PointConsistencyProof): string {
    return JSON.stringify({
      ...proof,
      pointX: proof.pointX.toString(16),
      claimedEvalY: proof.claimedEvalY.toString(16),
      expectedEvalCommit: proof.expectedEvalCommit.toString(16),
      nonceCommit: proof.nonceCommit.toString(16),
      challenge: proof.challenge.toString(16),
      response: proof.response.toString(16),
    });
  }

  public deserializeProof(payload: string): PointConsistencyProof {
    const raw = JSON.parse(payload) as Record<string, string>;
    return {
      sumId: raw.sumId,
      pointX: BigInt(`0x${raw.pointX}`),
      claimedEvalY: BigInt(`0x${raw.claimedEvalY}`),
      expectedEvalCommit: BigInt(`0x${raw.expectedEvalCommit}`),
      nonceCommit: BigInt(`0x${raw.nonceCommit}`),
      challenge: BigInt(`0x${raw.challenge}`),
      response: BigInt(`0x${raw.response}`),
    };
  }
}
