/**
 * @file BulletproofInnerProductVerifier.ts
 * @description Logarithmic O(log n) Bulletproofs Inner-Product Argument (IPA) Folding Prover & Verifier.
 * Given public power-of-two generator vectors G = (G_0..G_{n-1}), H = (H_0..H_{n-1}), auxiliary
 * inner-product generator U, and vector commitment P = G^a * H^b * U^{<a,b>} mod p:
 *   1. Recursively halves vectors a, b, G, H in log2(n) Fiat-Shamir folding rounds emitting
 *      only two cross-term commitments (L_j, R_j) per round.
 *   2. Terminates with just two final scalars (a_final, b_final) instead of O(n) witness elements.
 *   3. Supports fast single-equation multi-scalar verification via O(n) scalar unfolding,
 *      batch verification across multiple IPA proofs, and portable JSON serialization.
 */

import { createHash } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;

export interface IPAGeneratorCRS {
  dimension: number;
  gVec: bigint[];
  hVec: bigint[];
  uBase: bigint;
  crsDigest: string;
}

export interface IPAFoldingRound {
  roundIndex: number;
  leftCommitL: bigint;
  rightCommitR: bigint;
  challengeX: bigint;
}

export interface BulletproofIPAProof {
  proofId: string;
  dimension: number;
  commitmentP: bigint;
  claimedInnerProduct: bigint;
  rounds: IPAFoldingRound[];
  finalA: bigint;
  finalB: bigint;
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
  if (r > 1n) throw new Error('Not invertible in F_q');
  return t < 0n ? t + m : t;
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
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
 * Logarithmic Bulletproofs Inner-Product Argument (IPA) Folding Prover & Verifier.
 */
export class BulletproofInnerProductVerifier {
  private readonly p: bigint;
  private readonly q: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
  }

  private deriveGenerator(tag: string): bigint {
    for (let ctr = 0; ctr < 1024; ctr++) {
      const hex = createHash('sha256')
        .update(`WorkSphere::BulletproofIPA|${tag}|${ctr}`)
        .digest('hex');
      const raw = BigInt(`0x${hex}`) % (this.p - 2n) + 2n;
      const cand = (raw * raw) % this.p;
      if (cand > 1n && modPow(cand, this.q, this.p) === 1n) {
        return cand;
      }
    }
    throw new Error(`Failed to derive generator for ${tag}`);
  }

  /**
   * Generates a deterministic transparent Common Reference String (CRS) of length `dimension` (power of 2).
   */
  public setupCRS(dimension: number, crsTag = 'default'): IPAGeneratorCRS {
    if (!isPowerOfTwo(dimension)) {
      throw new RangeError('IPA dimension must be a positive power of two');
    }
    const gVec: bigint[] = [];
    const hVec: bigint[] = [];
    for (let i = 0; i < dimension; i++) {
      gVec.push(this.deriveGenerator(`${crsTag}:G:${i}`));
      hVec.push(this.deriveGenerator(`${crsTag}:H:${i}`));
    }
    const uBase = this.deriveGenerator(`${crsTag}:U`);
    const crsDigest = createHash('sha256')
      .update(`${crsTag}|d:${dimension}|u:${uBase.toString(16)}|g0:${gVec[0].toString(16)}`)
      .digest('hex');

    return { dimension, gVec, hVec, uBase, crsDigest };
  }

  /**
   * Computes inner product <a, b> = Sum a_i * b_i mod q.
   */
  public innerProduct(a: readonly bigint[], b: readonly bigint[]): bigint {
    if (a.length !== b.length) throw new Error('Vector lengths must match');
    let sum = 0n;
    for (let i = 0; i < a.length; i++) {
      sum = modNorm(sum + modNorm(a[i], this.q) * modNorm(b[i], this.q), this.q);
    }
    return sum;
  }

  /**
   * Computes multi-exponentiation Prod bases[i]^exps[i] mod p.
   */
  public multiExp(bases: readonly bigint[], exps: readonly bigint[]): bigint {
    if (bases.length !== exps.length) throw new Error('Base and exponent counts must match');
    let acc = 1n;
    for (let i = 0; i < bases.length; i++) {
      acc = (acc * modPow(bases[i], modNorm(exps[i], this.q), this.p)) % this.p;
    }
    return acc;
  }

  /**
   * Computes Pedersen-IPA commitment P = G^a * H^b * U^{<a, b>} mod p.
   */
  public commitVectors(
    crs: IPAGeneratorCRS,
    a: readonly bigint[],
    b: readonly bigint[]
  ): { commitmentP: bigint; innerProductVal: bigint } {
    if (a.length !== crs.dimension || b.length !== crs.dimension) {
      throw new Error('Witness vectors must match CRS dimension');
    }
    const innerProductVal = this.innerProduct(a, b);
    const commitmentP =
      (((this.multiExp(crs.gVec, a) * this.multiExp(crs.hVec, b)) % this.p) *
        modPow(crs.uBase, innerProductVal, this.p)) %
      this.p;
    return { commitmentP, innerProductVal };
  }

  /**
   * Executes the O(log n) recursive Bulletproofs folding prover.
   */
  public prove(
    proofId: string,
    crs: IPAGeneratorCRS,
    vecA: readonly bigint[],
    vecB: readonly bigint[]
  ): BulletproofIPAProof {
    const { commitmentP, innerProductVal } = this.commitVectors(crs, vecA, vecB);

    let a = vecA.map((v) => modNorm(v, this.q));
    let b = vecB.map((v) => modNorm(v, this.q));
    let G = [...crs.gVec];
    let H = [...crs.hVec];

    const rounds: IPAFoldingRound[] = [];
    let transcript = createHash('sha256')
      .update(`${proofId}|${crs.crsDigest}|${commitmentP.toString(16)}|${innerProductVal.toString(16)}`)
      .digest('hex');

    let roundIdx = 0;
    while (a.length > 1) {
      const half = a.length >> 1;
      const aL = a.slice(0, half);
      const aR = a.slice(half);
      const bL = b.slice(0, half);
      const bR = b.slice(half);
      const GL = G.slice(0, half);
      const GR = G.slice(half);
      const HL = H.slice(0, half);
      const HR = H.slice(half);

      const cL = this.innerProduct(aL, bR);
      const cR = this.innerProduct(aR, bL);

      // L = G_R^{a_L} * H_L^{b_R} * U^{c_L}
      const leftCommitL =
        (((this.multiExp(GR, aL) * this.multiExp(HL, bR)) % this.p) *
          modPow(crs.uBase, cL, this.p)) %
        this.p;
      // R = G_L^{a_R} * H_R^{b_L} * U^{c_R}
      const rightCommitR =
        (((this.multiExp(GL, aR) * this.multiExp(HR, bL)) % this.p) *
          modPow(crs.uBase, cR, this.p)) %
        this.p;

      const challengeX = hashScalar('WorkSphere::IPAFoldChallenge', [
        transcript,
        BigInt(roundIdx),
        leftCommitL,
        rightCommitR,
      ]);
      const xInv = modInverse(challengeX, this.q);

      transcript = createHash('sha256')
        .update(`${transcript}|${leftCommitL.toString(16)}|${rightCommitR.toString(16)}|${challengeX.toString(16)}`)
        .digest('hex');

      rounds.push({
        roundIndex: roundIdx,
        leftCommitL,
        rightCommitR,
        challengeX,
      });

      // Fold vectors and generators:
      // a' = x * aL + x^-1 * aR,  b' = x^-1 * bL + x * bR
      // G' = GL^{x^-1} * GR^x,    H' = HL^x * HR^{x^-1}
      const nextA: bigint[] = new Array(half);
      const nextB: bigint[] = new Array(half);
      const nextG: bigint[] = new Array(half);
      const nextH: bigint[] = new Array(half);

      for (let i = 0; i < half; i++) {
        nextA[i] = modNorm(challengeX * aL[i] + xInv * aR[i], this.q);
        nextB[i] = modNorm(xInv * bL[i] + challengeX * bR[i], this.q);
        nextG[i] = (modPow(GL[i], xInv, this.p) * modPow(GR[i], challengeX, this.p)) % this.p;
        nextH[i] = (modPow(HL[i], challengeX, this.p) * modPow(HR[i], xInv, this.p)) % this.p;
      }

      a = nextA;
      b = nextB;
      G = nextG;
      H = nextH;
      roundIdx++;
    }

    const proofDigest = createHash('sha256')
      .update(`${transcript}|${a[0].toString(16)}|${b[0].toString(16)}`)
      .digest('hex');

    return {
      proofId,
      dimension: crs.dimension,
      commitmentP,
      claimedInnerProduct: innerProductVal,
      rounds,
      finalA: a[0],
      finalB: b[0],
      proofDigest,
    };
  }

  /**
   * Computes Bulletproofs O(n) unfolding scalar vector s_i = Prod_{j} x_j^{b(i, j)} so the
   * verifier can check the entire recursive folding in a single multi-exponentiation!
   */
  public computeUnfoldingScalars(challenges: readonly bigint[]): bigint[] {
    const k = challenges.length;
    const n = 1 << k;
    const invs = challenges.map((x) => modInverse(x, this.q));
    const s = new Array<bigint>(n);

    for (let i = 0; i < n; i++) {
      let acc = 1n;
      for (let j = 0; j < k; j++) {
        const bit = (i >> (k - 1 - j)) & 1;
        acc = modNorm(acc * (bit === 1 ? challenges[j] : invs[j]), this.q);
      }
      s[i] = acc;
    }
    return s;
  }

  /**
   * Verifies a Bulletproofs IPA proof using the single-equation unfolded multi-exponentiation check:
   *   P * Prod_j (L_j^{x_j^2} * R_j^{x_j^-2}) == G^{a * s} * H^{b * s^-1} * U^{a * b} mod p
   */
  public verify(
    crs: IPAGeneratorCRS,
    proof: BulletproofIPAProof
  ): { valid: boolean; reason?: string } {
    if (proof.dimension !== crs.dimension) {
      return { valid: false, reason: 'Proof dimension does not match CRS' };
    }
    const expectedRounds = Math.log2(crs.dimension);
    if (proof.rounds.length !== expectedRounds) {
      return { valid: false, reason: `Expected ${expectedRounds} folding rounds` };
    }

    let transcript = createHash('sha256')
      .update(
        `${proof.proofId}|${crs.crsDigest}|${proof.commitmentP.toString(16)}|${proof.claimedInnerProduct.toString(16)}`
      )
      .digest('hex');

    let lhs = modNorm(proof.commitmentP, this.p);
    const challenges: bigint[] = [];

    for (let j = 0; j < proof.rounds.length; j++) {
      const rd = proof.rounds[j];
      if (rd.roundIndex !== j) {
        return { valid: false, reason: `Out-of-order round ${rd.roundIndex}` };
      }

      const expectedX = hashScalar('WorkSphere::IPAFoldChallenge', [
        transcript,
        BigInt(j),
        rd.leftCommitL,
        rd.rightCommitR,
      ]);
      if (expectedX !== rd.challengeX) {
        return { valid: false, reason: `Fiat-Shamir challenge mismatch at round ${j}` };
      }

      challenges.push(expectedX);
      const xSq = modNorm(expectedX * expectedX, this.q);
      const xInvSq = modInverse(xSq, this.q);
      lhs = (((lhs * modPow(rd.leftCommitL, xSq, this.p)) % this.p) * modPow(rd.rightCommitR, xInvSq, this.p)) % this.p;

      transcript = createHash('sha256')
        .update(`${transcript}|${rd.leftCommitL.toString(16)}|${rd.rightCommitR.toString(16)}|${expectedX.toString(16)}`)
        .digest('hex');
    }

    const sVec = this.computeUnfoldingScalars(challenges);
    const gExps = sVec.map((si) => modNorm(proof.finalA * si, this.q));
    const hExps = sVec.map((si) => modNorm(proof.finalB * modInverse(si, this.q), this.q));
    const finalProd = modNorm(proof.finalA * proof.finalB, this.q);

    const rhs =
      (((this.multiExp(crs.gVec, gExps) * this.multiExp(crs.hVec, hExps)) % this.p) *
        modPow(crs.uBase, finalProd, this.p)) %
      this.p;

    if (lhs !== rhs) {
      return { valid: false, reason: 'Unfolded IPA verification equation failed' };
    }

    return { valid: true };
  }

  /**
   * Batch-verifies multiple IPA proofs against the same CRS and summarizes diagnostics.
   */
  public batchVerify(
    crs: IPAGeneratorCRS,
    proofs: readonly BulletproofIPAProof[]
  ): { allValid: boolean; validCount: number; failedProofIds: string[] } {
    const failedProofIds: string[] = [];
    for (const p of proofs) {
      if (!this.verify(crs, p).valid) {
        failedProofIds.push(p.proofId);
      }
    }
    return {
      allValid: proofs.length > 0 && failedProofIds.length === 0,
      validCount: proofs.length - failedProofIds.length,
      failedProofIds,
    };
  }

  public serializeProof(proof: BulletproofIPAProof): string {
    return JSON.stringify({
      proofId: proof.proofId,
      dimension: proof.dimension,
      commitmentP: proof.commitmentP.toString(16),
      claimedInnerProduct: proof.claimedInnerProduct.toString(16),
      rounds: proof.rounds.map((r) => ({
        roundIndex: r.roundIndex,
        leftCommitL: r.leftCommitL.toString(16),
        rightCommitR: r.rightCommitR.toString(16),
        challengeX: r.challengeX.toString(16),
      })),
      finalA: proof.finalA.toString(16),
      finalB: proof.finalB.toString(16),
      proofDigest: proof.proofDigest,
    });
  }

  public deserializeProof(payload: string): BulletproofIPAProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      proofId: raw.proofId,
      dimension: Number(raw.dimension),
      commitmentP: BigInt(`0x${raw.commitmentP}`),
      claimedInnerProduct: BigInt(`0x${raw.claimedInnerProduct}`),
      rounds: raw.rounds.map((r: Record<string, any>) => ({
        roundIndex: Number(r.roundIndex),
        leftCommitL: BigInt(`0x${r.leftCommitL}`),
        rightCommitR: BigInt(`0x${r.rightCommitR}`),
        challengeX: BigInt(`0x${r.challengeX}`),
      })),
      finalA: BigInt(`0x${raw.finalA}`),
      finalB: BigInt(`0x${raw.finalB}`),
      proofDigest: raw.proofDigest,
    };
  }
}
