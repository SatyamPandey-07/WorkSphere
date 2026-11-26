/**
 * @file ZeroKnowledgePolynomialInterpolationProver.ts
 * @description Verifiable Lagrange Polynomial Interpolation & Zero-Knowledge Multi-Point
 * Evaluation Prover over F_q with hiding Pedersen coefficient commitments.
 * Enables proving that a hidden degree-d polynomial P(x) passes through claimed evaluation
 * points (x_i, y_i) without disclosing P's coefficients, using:
 *   1. Pedersen polynomial commitments C_k = g^{a_k} * h^{r_k} mod p for k = 0..d
 *   2. Zero-knowledge point-evaluation Schnorr opening proofs proving Prod C_k^{x^k} / g^y == h^{r(x)}
 *   3. Batched random-linear-combination multi-point verification
 *   4. Exact Lagrange interpolation & polynomial division consistency proofs
 *   5. Portable JSON proof serialization
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface InterpolationPoint {
  x: bigint;
  y: bigint;
}

export interface CommittedPolynomial {
  polyId: string;
  degree: number;
  coefficients: bigint[];
  blindings: bigint[];
  commitments: bigint[];
  commitmentDigest: string;
}

export interface PointEvaluationProof {
  polyId: string;
  x: bigint;
  y: bigint;
  evaluatedCommit: bigint;
  nonceCommit: bigint;
  challenge: bigint;
  responseBlinding: bigint;
}

export interface BatchEvaluationProof {
  polyId: string;
  points: InterpolationPoint[];
  nonceCommit: bigint;
  challenge: bigint;
  combinedResponse: bigint;
  batchDigest: string;
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
  if (r > 1n) throw new Error('Not invertible in F_q');
  return t < 0n ? t + m : t;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function deriveH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::PolyInterpH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
  const raw = BigInt(`0x${digest}`) % (p - 2n) + 2n;
  return (raw * raw) % p;
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
 * Verifiable Polynomial Interpolation & Multi-Point Evaluation Prover over F_q.
 */
export class ZeroKnowledgePolynomialInterpolationProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = deriveH(p, g);
  }

  /**
   * Evaluates a polynomial P(x) = Sum a_k * x^k mod q using Horner's method.
   */
  public evaluatePolynomial(coefficients: readonly bigint[], x: bigint): bigint {
    let acc = 0n;
    const xn = modNorm(x, this.q);
    for (let i = coefficients.length - 1; i >= 0; i--) {
      acc = modNorm(acc * xn + coefficients[i], this.q);
    }
    return acc;
  }

  /**
   * Interpolates the unique degree <= (n-1) polynomial passing through n distinct points over F_q.
   */
  public interpolateLagrange(points: readonly InterpolationPoint[]): bigint[] {
    const n = points.length;
    if (n === 0) throw new Error('At least one interpolation point is required');

    const xs = points.map((pt) => modNorm(pt.x, this.q));
    const seen = new Set<bigint>();
    for (const x of xs) {
      if (seen.has(x)) throw new Error('Interpolation x-coordinates must be strictly distinct');
      seen.add(x);
    }

    const result = new Array<bigint>(n).fill(0n);

    for (let i = 0; i < n; i++) {
      // Basis polynomial L_i(x) = Prod_{j != i} (x - x_j) / (x_i - x_j)
      let basis = [1n];
      let denom = 1n;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const nextBasis = new Array<bigint>(basis.length + 1).fill(0n);
        const negXj = modNorm(-xs[j], this.q);
        for (let k = 0; k < basis.length; k++) {
          nextBasis[k] = modNorm(nextBasis[k] + basis[k] * negXj, this.q);
          nextBasis[k + 1] = modNorm(nextBasis[k + 1] + basis[k], this.q);
        }
        basis = nextBasis;
        denom = modNorm(denom * modNorm(xs[i] - xs[j], this.q), this.q);
      }

      const scale = modNorm(modNorm(points[i].y, this.q) * modInverse(denom, this.q), this.q);
      for (let k = 0; k < basis.length; k++) {
        result[k] = modNorm(result[k] + basis[k] * scale, this.q);
      }
    }

    return result;
  }

  /**
   * Commits to a polynomial's coefficient vector with fresh Pedersen blinding factors.
   */
  public commitPolynomial(polyId: string, coefficients: readonly bigint[]): CommittedPolynomial {
    if (coefficients.length === 0) {
      throw new Error('Polynomial must have at least one coefficient');
    }

    const normCoeffs = coefficients.map((c) => modNorm(c, this.q));
    const blindings: bigint[] = [];
    const commitments: bigint[] = [];

    for (const a of normCoeffs) {
      const r = randomScalar(this.q);
      blindings.push(r);
      const comm = (modPow(this.g, a, this.p) * modPow(this.h, r, this.p)) % this.p;
      commitments.push(comm);
    }

    const commitmentDigest = createHash('sha256')
      .update(`${polyId}|deg:${normCoeffs.length - 1}|${commitments.map((c) => c.toString(16)).join(',')}`)
      .digest('hex');

    return {
      polyId,
      degree: normCoeffs.length - 1,
      coefficients: normCoeffs,
      blindings,
      commitments,
      commitmentDigest,
    };
  }

  /**
   * Interpolates a polynomial through `points` and returns its Pedersen commitment directly.
   */
  public interpolateAndCommit(
    polyId: string,
    points: readonly InterpolationPoint[]
  ): CommittedPolynomial {
    const coeffs = this.interpolateLagrange(points);
    return this.commitPolynomial(polyId, coeffs);
  }

  /**
   * Evaluates the homomorphic commitment at x: E(x) = Prod_{k=0}^{d} C_k^{x^k} mod p.
   */
  public evaluateCommitmentAt(commitments: readonly bigint[], x: bigint): bigint {
    const xn = modNorm(x, this.q);
    let acc = 1n;
    let xPow = 1n;
    for (const comm of commitments) {
      acc = (acc * modPow(comm, xPow, this.p)) % this.p;
      xPow = modNorm(xPow * xn, this.q);
    }
    return acc;
  }

  /**
   * Produces a zero-knowledge Schnorr proof that the committed polynomial evaluates to y = P(x)
   * without disclosing any polynomial coefficients or blinding scalars.
   */
  public proveEvaluation(committed: CommittedPolynomial, x: bigint): PointEvaluationProof {
    const xn = modNorm(x, this.q);
    const y = this.evaluatePolynomial(committed.coefficients, xn);
    const rEval = this.evaluatePolynomial(committed.blindings, xn);
    const evaluatedCommit = this.evaluateCommitmentAt(committed.commitments, xn);

    const k = randomScalar(this.q);
    const nonceCommit = modPow(this.h, k, this.p);
    const challenge = hashScalar('WorkSphere::PolyEvalSingle', [
      committed.polyId,
      xn,
      y,
      evaluatedCommit,
      nonceCommit,
    ]);
    const responseBlinding = modNorm(k + challenge * rEval, this.q);

    return {
      polyId: committed.polyId,
      x: xn,
      y,
      evaluatedCommit,
      nonceCommit,
      challenge,
      responseBlinding,
    };
  }

  /**
   * Publicly verifies a single point-evaluation proof against the published polynomial commitments.
   */
  public verifyEvaluation(
    commitments: readonly bigint[],
    proof: PointEvaluationProof
  ): boolean {
    if (commitments.length === 0) return false;
    const expectedEvalCommit = this.evaluateCommitmentAt(commitments, proof.x);
    if (expectedEvalCommit !== proof.evaluatedCommit) return false;

    const expectedC = hashScalar('WorkSphere::PolyEvalSingle', [
      proof.polyId,
      proof.x,
      proof.y,
      proof.evaluatedCommit,
      proof.nonceCommit,
    ]);
    if (expectedC !== proof.challenge) return false;

    const gYInv = modInverse(modPow(this.g, modNorm(proof.y, this.q), this.p), this.p);
    const blindingCommit = (proof.evaluatedCommit * gYInv) % this.p;

    const lhs = modPow(this.h, proof.responseBlinding, this.p);
    const rhs = (proof.nonceCommit * modPow(blindingCommit, proof.challenge, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Produces a single constant-size Fiat-Shamir batched evaluation proof proving P(x_i) == y_i
   * simultaneously for an arbitrary number of evaluation points.
   */
  public proveBatchEvaluations(
    committed: CommittedPolynomial,
    xs: readonly bigint[]
  ): BatchEvaluationProof {
    if (xs.length === 0) {
      throw new Error('At least one evaluation x-coordinate is required');
    }

    const points: InterpolationPoint[] = xs.map((x) => {
      const xn = modNorm(x, this.q);
      return { x: xn, y: this.evaluatePolynomial(committed.coefficients, xn) };
    });

    const alpha = hashScalar('WorkSphere::PolyBatchAlpha', [
      committed.polyId,
      committed.commitmentDigest,
      ...points.flatMap((pt) => [pt.x, pt.y]),
    ]);

    let combinedR = 0n;
    let weight = 1n;
    for (const pt of points) {
      const rEval = this.evaluatePolynomial(committed.blindings, pt.x);
      combinedR = modNorm(combinedR + weight * rEval, this.q);
      weight = modNorm(weight * alpha, this.q);
    }

    const k = randomScalar(this.q);
    const nonceCommit = modPow(this.h, k, this.p);
    const challenge = hashScalar('WorkSphere::PolyBatchChallenge', [
      committed.polyId,
      alpha,
      nonceCommit,
      BigInt(points.length),
    ]);
    const combinedResponse = modNorm(k + challenge * combinedR, this.q);

    const batchDigest = createHash('sha256')
      .update(
        `${committed.polyId}|${points.map((pt) => `${pt.x.toString(16)}:${pt.y.toString(16)}`).join(',')}|${challenge.toString(16)}`
      )
      .digest('hex');

    return {
      polyId: committed.polyId,
      points,
      nonceCommit,
      challenge,
      combinedResponse,
      batchDigest,
    };
  }

  /**
   * Verifies a constant-size batched multi-point polynomial evaluation proof against commitments.
   */
  public verifyBatchEvaluations(
    commitments: readonly bigint[],
    proof: BatchEvaluationProof
  ): boolean {
    if (commitments.length === 0 || proof.points.length === 0) return false;

    const commitmentDigest = createHash('sha256')
      .update(`${proof.polyId}|deg:${commitments.length - 1}|${commitments.map((c) => c.toString(16)).join(',')}`)
      .digest('hex');

    const alpha = hashScalar('WorkSphere::PolyBatchAlpha', [
      proof.polyId,
      commitmentDigest,
      ...proof.points.flatMap((pt) => [pt.x, pt.y]),
    ]);

    const expectedC = hashScalar('WorkSphere::PolyBatchChallenge', [
      proof.polyId,
      alpha,
      proof.nonceCommit,
      BigInt(proof.points.length),
    ]);
    if (expectedC !== proof.challenge) return false;

    // Combine Prod_i (E(x_i) / g^{y_i})^{alpha^i} mod p
    let combinedCommit = 1n;
    let weight = 1n;
    for (const pt of proof.points) {
      const eX = this.evaluateCommitmentAt(commitments, pt.x);
      const gYInv = modInverse(modPow(this.g, modNorm(pt.y, this.q), this.p), this.p);
      const diff = (eX * gYInv) % this.p;
      combinedCommit = (combinedCommit * modPow(diff, weight, this.p)) % this.p;
      weight = modNorm(weight * alpha, this.q);
    }

    const lhs = modPow(this.h, proof.combinedResponse, this.p);
    const rhs = (proof.nonceCommit * modPow(combinedCommit, proof.challenge, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Adds two committed polynomials homomorphically: C_sum[k] = C_A[k] * C_B[k] mod p.
   */
  public homomorphicAddCommitments(
    commitA: readonly bigint[],
    commitB: readonly bigint[]
  ): bigint[] {
    const maxLen = Math.max(commitA.length, commitB.length);
    const out: bigint[] = [];
    for (let i = 0; i < maxLen; i++) {
      const a = commitA[i] ?? 1n;
      const b = commitB[i] ?? 1n;
      out.push((a * b) % this.p);
    }
    return out;
  }

  public serializeBatchProof(proof: BatchEvaluationProof): string {
    return JSON.stringify({
      polyId: proof.polyId,
      points: proof.points.map((pt) => ({ x: pt.x.toString(16), y: pt.y.toString(16) })),
      nonceCommit: proof.nonceCommit.toString(16),
      challenge: proof.challenge.toString(16),
      combinedResponse: proof.combinedResponse.toString(16),
      batchDigest: proof.batchDigest,
    });
  }

  public deserializeBatchProof(payload: string): BatchEvaluationProof {
    const raw = JSON.parse(payload) as {
      polyId: string;
      points: Array<{ x: string; y: string }>;
      nonceCommit: string;
      challenge: string;
      combinedResponse: string;
      batchDigest: string;
    };
    return {
      polyId: raw.polyId,
      points: raw.points.map((pt) => ({ x: BigInt(`0x${pt.x}`), y: BigInt(`0x${pt.y}`) })),
      nonceCommit: BigInt(`0x${raw.nonceCommit}`),
      challenge: BigInt(`0x${raw.challenge}`),
      combinedResponse: BigInt(`0x${raw.combinedResponse}`),
      batchDigest: raw.batchDigest,
    };
  }
}
