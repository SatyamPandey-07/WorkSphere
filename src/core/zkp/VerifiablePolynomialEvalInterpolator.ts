import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Lagrange Polynomial Interpolation & Committed Evaluation Prover.
 *
 * Given a set of evaluation points {(x_0, y_0), ..., (x_{n-1}, y_{n-1})} over F_Q:
 *  1. Computes exact Lagrange interpolation in F_Q to obtain canonical monomial coefficients
 *     P(x) = a_0 + a_1*x + ... + a_{n-1}*x^{n-1}.
 *  2. Commits to each monomial coefficient via hiding Pedersen commitments C_k = g^{a_k} * h^{r_k}.
 *  3. Generates a succinct Fiat-Shamir proof certifying that the committed polynomial P(x)
 *     passes through every claimed point (x_i, y_i) AND opens at a fresh verifier query point z
 *     without exposing the polynomial coefficients!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function modInv(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = ((a % m) + m) % m;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Scalar not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function hashToScalar(...parts: string[]): bigint {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return modScalar(BigInt('0x' + h.digest('hex').slice(0, 32)));
}

function deriveH(): bigint {
  const digest = createHash('sha256').update('VERIFIABLE-LAGRANGE-INTERP-H-V1').digest('hex');
  const raw = (BigInt('0x' + digest.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface EvalPoint {
  x: bigint;
  y: bigint;
}

export interface InterpolatedCommitment {
  coefficients: bigint[];
  blindings: bigint[];
  commitments: bigint[];
}

export interface InterpolationConsistencyProof {
  points: EvalPoint[];
  commitments: bigint[];
  foldingAlpha: bigint;
  announcementR: bigint;
  challenge: bigint;
  responseBlinding: bigint;
  context: string;
}

export interface SingleEvalOpeningProof {
  x: bigint;
  claimedY: bigint;
  commitments: bigint[];
  announcementR: bigint;
  challenge: bigint;
  responseBlinding: bigint;
  context: string;
}

export class VerifiablePolynomialEvalInterpolator {
  public evalPoly(coeffs: bigint[], x: bigint): bigint {
    const xn = modScalar(x);
    let acc = 0n;
    let xp = 1n;
    for (const c of coeffs) {
      acc = modScalar(acc + modScalar(c) * xp);
      xp = modScalar(xp * xn);
    }
    return acc;
  }

  public interpolate(points: EvalPoint[]): bigint[] {
    const n = points.length;
    if (n === 0) throw new Error('Need at least one point to interpolate');
    const seenX = new Set<bigint>();
    for (const p of points) {
      const xn = modScalar(p.x);
      if (seenX.has(xn)) throw new Error('Interpolation x-coordinates must be pairwise distinct');
      seenX.add(xn);
    }

    const result = new Array<bigint>(n).fill(0n);

    for (let i = 0; i < n; i++) {
      const xi = modScalar(points[i].x);
      const yi = modScalar(points[i].y);

      // Build basis numerator prod_{j != i} (x - x_j) and denominator prod_{j != i} (x_i - x_j)
      let basis = [1n];
      let denom = 1n;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const xj = modScalar(points[j].x);
        denom = modScalar(denom * modScalar(xi - xj));
        const next = new Array<bigint>(basis.length + 1).fill(0n);
        for (let k = 0; k < basis.length; k++) {
          next[k] = modScalar(next[k] - basis[k] * xj);
          next[k + 1] = modScalar(next[k + 1] + basis[k]);
        }
        basis = next;
      }

      const scale = modScalar(yi * modInv(denom, SUBGROUP_Q));
      for (let k = 0; k < basis.length; k++) {
        result[k] = modScalar(result[k] + basis[k] * scale);
      }
    }

    return result;
  }

  public commitInterpolated(points: EvalPoint[]): InterpolatedCommitment {
    const coefficients = this.interpolate(points);
    const blindings = coefficients.map(() => randomScalar());
    const commitments = coefficients.map((c, i) =>
      (modPow(BASE_G, c, SAFE_PRIME_P) * modPow(BASE_H, blindings[i], SAFE_PRIME_P)) % SAFE_PRIME_P,
    );
    return { coefficients, blindings, commitments };
  }

  public evalCommitment(commitments: bigint[], x: bigint): bigint {
    const xn = modScalar(x);
    let acc = 1n;
    let xp = 1n;
    for (const Ck of commitments) {
      acc = (acc * modPow(Ck, xp, SAFE_PRIME_P)) % SAFE_PRIME_P;
      xp = modScalar(xp * xn);
    }
    return acc;
  }

  /**
   * Proves simultaneously that the committed polynomial interpolates ALL points (x_i, y_i)
   * using a Fiat-Shamir random linear folding scalar alpha across all evaluation equations.
   */
  public proveInterpolationConsistency(
    points: EvalPoint[],
    committed: InterpolatedCommitment,
    context = 'interp-v1',
  ): InterpolationConsistencyProof {
    const foldingAlpha = hashToScalar(
      'INTERP-FOLD-ALPHA-V1',
      context,
      ...points.map((p) => `${modScalar(p.x).toString(16)}:${modScalar(p.y).toString(16)}`),
      ...committed.commitments.map((c) => c.toString(16)),
    );

    let alphaPow = 1n;
    let foldedBlinding = 0n;
    for (const p of points) {
      if (this.evalPoly(committed.coefficients, p.x) !== modScalar(p.y)) {
        throw new Error('Committed polynomial does not match provided interpolation point');
      }
      const rAtX = this.evalPoly(committed.blindings, p.x);
      foldedBlinding = modScalar(foldedBlinding + alphaPow * rAtX);
      alphaPow = modScalar(alphaPow * foldingAlpha);
    }

    const k = randomScalar();
    const announcementR = modPow(BASE_H, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'INTERP-FOLD-CHALLENGE-V1',
      foldingAlpha.toString(16),
      announcementR.toString(16),
      context,
    );
    const responseBlinding = modScalar(k + challenge * foldedBlinding);

    return {
      points: points.map((p) => ({ x: modScalar(p.x), y: modScalar(p.y) })),
      commitments: [...committed.commitments],
      foldingAlpha,
      announcementR,
      challenge,
      responseBlinding,
      context,
    };
  }

  public verifyInterpolationConsistency(proof: InterpolationConsistencyProof): boolean {
    if (proof.points.length === 0 || proof.commitments.length === 0) return false;
    const expectedAlpha = hashToScalar(
      'INTERP-FOLD-ALPHA-V1',
      proof.context,
      ...proof.points.map((p) => `${modScalar(p.x).toString(16)}:${modScalar(p.y).toString(16)}`),
      ...proof.commitments.map((c) => c.toString(16)),
    );
    if (expectedAlpha !== proof.foldingAlpha) return false;

    const expectedC = hashToScalar(
      'INTERP-FOLD-CHALLENGE-V1',
      proof.foldingAlpha.toString(16),
      proof.announcementR.toString(16),
      proof.context,
    );
    if (expectedC !== proof.challenge) return false;

    let alphaPow = 1n;
    let foldedTarget = 1n;
    for (const p of proof.points) {
      const cAtX = this.evalCommitment(proof.commitments, p.x);
      const gNegY = modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(p.y)), SAFE_PRIME_P);
      const diff = (cAtX * gNegY) % SAFE_PRIME_P;
      foldedTarget = (foldedTarget * modPow(diff, alphaPow, SAFE_PRIME_P)) % SAFE_PRIME_P;
      alphaPow = modScalar(alphaPow * proof.foldingAlpha);
    }

    const lhs = modPow(BASE_H, proof.responseBlinding, SAFE_PRIME_P);
    const rhs = (proof.announcementR * modPow(foldedTarget, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public provePointEvaluation(
    committed: InterpolatedCommitment,
    x: bigint,
    context = 'eval-v1',
  ): SingleEvalOpeningProof {
    const xn = modScalar(x);
    const claimedY = this.evalPoly(committed.coefficients, xn);
    const rAtX = this.evalPoly(committed.blindings, xn);
    const k = randomScalar();
    const announcementR = modPow(BASE_H, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'INTERP-EVAL-OPEN-V1',
      xn.toString(16),
      claimedY.toString(16),
      announcementR.toString(16),
      context,
      ...committed.commitments.map((c) => c.toString(16)),
    );
    const responseBlinding = modScalar(k + challenge * rAtX);
    return {
      x: xn,
      claimedY,
      commitments: [...committed.commitments],
      announcementR,
      challenge,
      responseBlinding,
      context,
    };
  }

  public verifyPointEvaluation(proof: SingleEvalOpeningProof): boolean {
    const expectedC = hashToScalar(
      'INTERP-EVAL-OPEN-V1',
      proof.x.toString(16),
      proof.claimedY.toString(16),
      proof.announcementR.toString(16),
      proof.context,
      ...proof.commitments.map((c) => c.toString(16)),
    );
    if (expectedC !== proof.challenge) return false;
    const cAtX = this.evalCommitment(proof.commitments, proof.x);
    const gNegY = modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(proof.claimedY)), SAFE_PRIME_P);
    const target = (cAtX * gNegY) % SAFE_PRIME_P;
    return modPow(BASE_H, proof.responseBlinding, SAFE_PRIME_P) ===
      (proof.announcementR * modPow(target, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public serializeConsistencyProof(proof: InterpolationConsistencyProof): string {
    return JSON.stringify({
      pointCount: proof.points.length,
      degree: proof.commitments.length - 1,
      foldingAlpha: proof.foldingAlpha.toString(16),
      context: proof.context,
    });
  }
}
