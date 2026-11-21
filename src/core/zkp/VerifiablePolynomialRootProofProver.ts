/**
 * @file VerifiablePolynomialRootProofProver.ts
 * @description Zero-Knowledge Polynomial Root & Vanishing-Ideal Divisibility Prover over F_q.
 * Proves that a hidden Pedersen-committed polynomial P(x) vanishes on a public set of roots
 * Z = {z_1, ..., z_k} — i.e., P(x) = Q(x) * Z_vanish(x) where Z_vanish(x) = Prod (x - z_i) —
 * WITHOUT disclosing P(x) or Q(x):
 *   1. Prover commits to P(x) and quotient polynomial Q(x) = P(x) / Z_vanish(x) using hiding
 *      Pedersen coefficient commitments.
 *   2. Fiat-Shamir evaluation challenge zeta is sampled outside Z.
 *   3. Verifier homomorphically computes Com(P(zeta)) and Com(Q(zeta))^{Z_vanish(zeta)} and checks
 *      the Schnorr blinding-difference proof showing P(zeta) == Q(zeta) * Z_vanish(zeta) mod q!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface CommittedPoly {
  polyId: string;
  coefficients: bigint[];
  blindings: bigint[];
  commitments: bigint[];
}

export interface VanishingDivisibilityProof {
  proofId: string;
  roots: bigint[];
  polyCommitmentsP: bigint[];
  quotientCommitmentsQ: bigint[];
  rounds: Array<{
    roundIndex: number;
    challengeZeta: bigint;
    vanishingAtZeta: bigint;
    nonceCommit: bigint;
    fiatShamirC: bigint;
    responseDeltaR: bigint;
  }>;
  proofDigest: string;
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

function deriveH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::VanishPolyH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
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
 * Zero-Knowledge Polynomial Root & Vanishing-Ideal Divisibility Prover over F_q.
 */
export class VerifiablePolynomialRootProofProver {
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

  public evaluatePoly(coeffs: readonly bigint[], x: bigint): bigint {
    let acc = 0n;
    const xn = modNorm(x, this.q);
    for (let i = coeffs.length - 1; i >= 0; i--) {
      acc = modNorm(acc * xn + coeffs[i], this.q);
    }
    return acc;
  }

  /**
   * Builds the monic vanishing polynomial Z(x) = Prod_{r in roots} (x - r) mod q.
   */
  public buildVanishingPoly(roots: readonly bigint[]): bigint[] {
    if (roots.length === 0) throw new Error('At least one root is required');
    let poly = [1n];
    for (const root of roots) {
      const negR = modNorm(-root, this.q);
      const next = new Array<bigint>(poly.length + 1).fill(0n);
      for (let i = 0; i < poly.length; i++) {
        next[i] = modNorm(next[i] + poly[i] * negR, this.q);
        next[i + 1] = modNorm(next[i + 1] + poly[i], this.q);
      }
      poly = next;
    }
    return poly;
  }

  /**
   * Multiplies two polynomials A(x) * B(x) mod q.
   */
  public multiplyPolys(a: readonly bigint[], b: readonly bigint[]): bigint[] {
    const out = new Array<bigint>(a.length + b.length - 1).fill(0n);
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        out[i + j] = modNorm(out[i + j] + modNorm(a[i], this.q) * modNorm(b[j], this.q), this.q);
      }
    }
    return out;
  }

  /**
   * Exact Euclidean polynomial division P(x) = Q(x) * D(x) + R(x) over F_q.
   */
  public dividePolys(
    dividend: readonly bigint[],
    divisor: readonly bigint[]
  ): { quotient: bigint[]; remainder: bigint[] } {
    const rem = dividend.map((c) => modNorm(c, this.q));
    let degD = divisor.length - 1;
    while (degD > 0 && modNorm(divisor[degD], this.q) === 0n) degD--;
    const leadD = modNorm(divisor[degD], this.q);
    if (leadD === 0n) throw new Error('Division by zero polynomial');
    const leadDInv = modInverse(leadD, this.q);

    if (rem.length - 1 < degD) {
      return { quotient: [0n], remainder: rem };
    }

    const quotient = new Array<bigint>(rem.length - degD).fill(0n);
    for (let i = rem.length - 1; i >= degD; i--) {
      const coeff = modNorm(rem[i] * leadDInv, this.q);
      quotient[i - degD] = coeff;
      for (let j = 0; j <= degD; j++) {
        rem[i - degD + j] = modNorm(rem[i - degD + j] - coeff * modNorm(divisor[j], this.q), this.q);
      }
    }

    let degR = rem.length - 1;
    while (degR > 0 && rem[degR] === 0n) degR--;
    return { quotient, remainder: rem.slice(0, degR + 1) };
  }

  public commitPoly(polyId: string, coefficients: readonly bigint[]): CommittedPoly {
    const norm = coefficients.map((c) => modNorm(c, this.q));
    const blindings: bigint[] = [];
    const commitments: bigint[] = [];
    for (const c of norm) {
      const r = randomScalar(this.q);
      blindings.push(r);
      commitments.push((modPow(this.g, c, this.p) * modPow(this.h, r, this.p)) % this.p);
    }
    return { polyId, coefficients: norm, blindings, commitments };
  }

  private evalCommitment(commitments: readonly bigint[], x: bigint): bigint {
    let acc = 1n;
    let xPow = 1n;
    const xn = modNorm(x, this.q);
    for (const c of commitments) {
      acc = (acc * modPow(c, xPow, this.p)) % this.p;
      xPow = modNorm(xPow * xn, this.q);
    }
    return acc;
  }

  private computeTranscriptSeed(
    proofId: string,
    roots: readonly bigint[],
    commP: readonly bigint[],
    commQ: readonly bigint[]
  ): string {
    const h = createHash('sha256');
    h.update(`WorkSphere::VanishSeed|${proofId}`);
    for (const r of roots) h.update(`|r:${modNorm(r, this.q).toString(16)}`);
    for (const c of commP) h.update(`|p:${c.toString(16)}`);
    for (const c of commQ) h.update(`|q:${c.toString(16)}`);
    return h.digest('hex');
  }

  /**
   * Proves in zero knowledge that committed polynomial P(x) vanishes at every root in `roots`
   * (i.e. P(r) == 0 mod q for all r in roots) via exact quotient commitment Q(x) = P(x) / Z(x).
   */
  public proveVanishingRoots(
    proofId: string,
    committedP: CommittedPoly,
    roots: readonly bigint[],
    soundnessRounds = 3
  ): VanishingDivisibilityProof {
    const normRoots = roots.map((r) => modNorm(r, this.q));
    const vanishPoly = this.buildVanishingPoly(normRoots);
    const { quotient, remainder } = this.dividePolys(committedP.coefficients, vanishPoly);

    if (remainder.some((c) => c !== 0n)) {
      throw new Error('Polynomial P(x) does NOT vanish on all specified roots');
    }

    const committedQ = this.commitPoly(`${proofId}:Q`, quotient);
    const seed = this.computeTranscriptSeed(
      proofId,
      normRoots,
      committedP.commitments,
      committedQ.commitments
    );

    const rounds: VanishingDivisibilityProof['rounds'] = [];
    for (let idx = 0; idx < soundnessRounds; idx++) {
      const challengeZeta = hashScalar('WorkSphere::VanishZeta', [proofId, seed, BigInt(idx)]);
      const vanishingAtZeta = this.evaluatePoly(vanishPoly, challengeZeta);

      const rP = this.evaluatePoly(committedP.blindings, challengeZeta);
      const rQ = this.evaluatePoly(committedQ.blindings, challengeZeta);
      // Since P(zeta) == Q(zeta) * Z(zeta), Com(P(zeta)) / Com(Q(zeta))^{Z(zeta)} = h^{rP - rQ * Z(zeta)}
      const deltaR = modNorm(rP - rQ * vanishingAtZeta, this.q);

      const k = randomScalar(this.q);
      const nonceCommit = modPow(this.h, k, this.p);
      const fiatShamirC = hashScalar('WorkSphere::VanishRoundC', [
        proofId,
        seed,
        BigInt(idx),
        challengeZeta,
        nonceCommit,
      ]);
      const responseDeltaR = modNorm(k + fiatShamirC * deltaR, this.q);

      rounds.push({
        roundIndex: idx,
        challengeZeta,
        vanishingAtZeta,
        nonceCommit,
        fiatShamirC,
        responseDeltaR,
      });
    }

    const proofDigest = createHash('sha256')
      .update(`${proofId}|${seed}|${rounds.map((r) => r.fiatShamirC.toString(16)).join(',')}`)
      .digest('hex');

    return {
      proofId,
      roots: normRoots,
      polyCommitmentsP: [...committedP.commitments],
      quotientCommitmentsQ: [...committedQ.commitments],
      rounds,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a zero-knowledge vanishing-ideal divisibility proof against P's commitments!
   */
  public verifyVanishingRoots(
    proof: VanishingDivisibilityProof
  ): { valid: boolean; reason?: string } {
    if (proof.roots.length === 0 || proof.rounds.length === 0) {
      return { valid: false, reason: 'Missing roots or verification rounds' };
    }
    if (proof.polyCommitmentsP.length < proof.roots.length + 1) {
      return { valid: false, reason: 'Degree of P too small for claimed vanishing set' };
    }
    const maxQuotientLen = proof.polyCommitmentsP.length - proof.roots.length;
    if (proof.quotientCommitmentsQ.length > maxQuotientLen) {
      return { valid: false, reason: 'Quotient polynomial degree exceeds deg(P) - |roots|' };
    }

    const vanishPoly = this.buildVanishingPoly(proof.roots);
    const seed = this.computeTranscriptSeed(
      proof.proofId,
      proof.roots,
      proof.polyCommitmentsP,
      proof.quotientCommitmentsQ
    );

    for (let idx = 0; idx < proof.rounds.length; idx++) {
      const rd = proof.rounds[idx];
      if (rd.roundIndex !== idx) return { valid: false, reason: 'Out-of-order round index' };

      const expectedZeta = hashScalar('WorkSphere::VanishZeta', [proof.proofId, seed, BigInt(idx)]);
      const expectedZVal = this.evaluatePoly(vanishPoly, expectedZeta);
      if (expectedZeta !== rd.challengeZeta || expectedZVal !== rd.vanishingAtZeta) {
        return { valid: false, reason: `Challenge zeta or Z(zeta) mismatch at round ${idx}` };
      }

      const expectedC = hashScalar('WorkSphere::VanishRoundC', [
        proof.proofId,
        seed,
        BigInt(idx),
        expectedZeta,
        rd.nonceCommit,
      ]);
      if (expectedC !== rd.fiatShamirC) {
        return { valid: false, reason: `Fiat-Shamir challenge mismatch at round ${idx}` };
      }

      const evalP = this.evalCommitment(proof.polyCommitmentsP, expectedZeta);
      const evalQ = this.evalCommitment(proof.quotientCommitmentsQ, expectedZeta);
      const evalQZ = modPow(evalQ, expectedZVal, this.p);
      const ratio = (evalP * modInverse(evalQZ, this.p)) % this.p;

      const lhs = modPow(this.h, modNorm(rd.responseDeltaR, this.q), this.p);
      const rhs = (rd.nonceCommit * modPow(ratio, rd.fiatShamirC, this.p)) % this.p;
      if (lhs !== rhs) {
        return { valid: false, reason: `Divisibility check failed at round ${idx}` };
      }
    }

    return { valid: true };
  }

  public serializeProof(proof: VanishingDivisibilityProof): string {
    return JSON.stringify({
      proofId: proof.proofId,
      roots: proof.roots.map((r) => r.toString(16)),
      polyCommitmentsP: proof.polyCommitmentsP.map((c) => c.toString(16)),
      quotientCommitmentsQ: proof.quotientCommitmentsQ.map((c) => c.toString(16)),
      rounds: proof.rounds.map((rd) => ({
        roundIndex: rd.roundIndex,
        challengeZeta: rd.challengeZeta.toString(16),
        vanishingAtZeta: rd.vanishingAtZeta.toString(16),
        nonceCommit: rd.nonceCommit.toString(16),
        fiatShamirC: rd.fiatShamirC.toString(16),
        responseDeltaR: rd.responseDeltaR.toString(16),
      })),
      proofDigest: proof.proofDigest,
    });
  }

  public deserializeProof(payload: string): VanishingDivisibilityProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      proofId: raw.proofId,
      roots: raw.roots.map((r: string) => BigInt(`0x${r}`)),
      polyCommitmentsP: raw.polyCommitmentsP.map((c: string) => BigInt(`0x${c}`)),
      quotientCommitmentsQ: raw.quotientCommitmentsQ.map((c: string) => BigInt(`0x${c}`)),
      rounds: raw.rounds.map((rd: Record<string, any>) => ({
        roundIndex: Number(rd.roundIndex),
        challengeZeta: BigInt(`0x${rd.challengeZeta}`),
        vanishingAtZeta: BigInt(`0x${rd.vanishingAtZeta}`),
        nonceCommit: BigInt(`0x${rd.nonceCommit}`),
        fiatShamirC: BigInt(`0x${rd.fiatShamirC}`),
        responseDeltaR: BigInt(`0x${rd.responseDeltaR}`),
      })),
      proofDigest: raw.proofDigest,
    };
  }
}
