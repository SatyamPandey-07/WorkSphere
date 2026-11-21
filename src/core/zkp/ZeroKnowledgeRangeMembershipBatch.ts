import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Multi-Interval Disjunctive Range Membership Prover.
 *
 * Proves in zero knowledge that a secretly committed value C = g^v * h^r mod P belongs
 * to the UNION of K disjoint allowed intervals:
 *   v in [L_0, U_0] U [L_1, U_1] U ... U [L_{K-1}, U_{K-1}]
 * WITHOUT disclosing either v OR WHICH interval j contains v!
 *
 * Protocol:
 *  - For the real interval j (where L_j <= v <= U_j), prover creates a fresh commitment
 *    to v and proves BOTH (v - L_j >= 0) and (U_j - v >= 0) via bit-decomposition OR-proofs,
 *    plus an equality relation tying C_branch_j == C via real Schnorr PoK of deltaBlinding.
 *  - For every other (decoy) interval i != j, prover commits to a valid dummy midpoint
 *    d_i in [L_i, U_i], generates honest range proofs for C_branch_i, and SIMULATES the
 *    equality branch proving log_h(C / C_branch_i) in a Fiat-Shamir 1-of-K OR-disjunction!
 *  - Verifier confirms:
 *      1. Every branch i has valid range proofs for [L_i, U_i] on C_branch_i
 *      2. The 1-of-K equality OR-proof proves C commits to the EXACT same value as AT LEAST
 *         ONE C_branch_i — hiding which interval matched!
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

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  return modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
}

function deriveH(): bigint {
  const raw = (BigInt('0x' + sha256Hex('ZK-RANGE-DISJUNCT-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();
const INV_G = modPow(BASE_G, SAFE_PRIME_P - 2n, SAFE_PRIME_P);

export interface AllowedInterval {
  min: bigint;
  max: bigint;
}

export interface RangeBitOR {
  bitCommitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  s0: bigint;
  s1: bigint;
}

export interface GapProof {
  commitment: bigint;
  bitLength: number;
  bits: RangeBitOR[];
}

export interface IntervalBranchProof {
  min: bigint;
  max: bigint;
  branchCommitment: bigint;
  lowerGap: GapProof;
  upperGap: GapProof;
  eqAnnounceR: bigint;
  eqChallenge: bigint;
  eqResponse: bigint;
}

export interface MultiIntervalMembershipProof {
  targetCommitment: bigint;
  intervals: AllowedInterval[];
  branches: IntervalBranchProof[];
  orRootChallenge: bigint;
  context: string;
}

export class ZeroKnowledgeRangeMembershipBatch {
  public commit(value: bigint, blinding?: bigint): { commitment: bigint; blinding: bigint } {
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, modScalar(value), SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { commitment, blinding: r };
  }

  private requiredBits(span: bigint): number {
    if (span <= 0n) return 1;
    return span.toString(2).length;
  }

  private proveBit(bit: 0 | 1, blinding: bigint, tag: string): RangeBitOR {
    const bitCommitment = (modPow(BASE_G, BigInt(bit), SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const cDivG = (bitCommitment * INV_G) % SAFE_PRIME_P;
    if (bit === 0) {
      const k0 = randomScalar();
      const a0 = modPow(BASE_H, k0, SAFE_PRIME_P);
      const c1 = randomScalar();
      const s1 = randomScalar();
      const a1 = (modPow(BASE_H, s1, SAFE_PRIME_P) * modPow(cDivG, modScalar(SUBGROUP_Q - c1), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const e = hashToScalar('RANGE-MEM-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c0 = modScalar(e - c1);
      const s0 = modScalar(k0 + c0 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    } else {
      const c0 = randomScalar();
      const s0 = randomScalar();
      const a0 = (modPow(BASE_H, s0, SAFE_PRIME_P) * modPow(bitCommitment, modScalar(SUBGROUP_Q - c0), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const k1 = randomScalar();
      const a1 = modPow(BASE_H, k1, SAFE_PRIME_P);
      const e = hashToScalar('RANGE-MEM-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c1 = modScalar(e - c0);
      const s1 = modScalar(k1 + c1 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    }
  }

  private verifyBit(bp: RangeBitOR, tag: string): boolean {
    const e = hashToScalar('RANGE-MEM-BIT-V1', bp.bitCommitment.toString(16), bp.a0.toString(16), bp.a1.toString(16), tag);
    if (modScalar(bp.c0 + bp.c1) !== e) return false;
    if (modPow(BASE_H, bp.s0, SAFE_PRIME_P) !== (bp.a0 * modPow(bp.bitCommitment, bp.c0, SAFE_PRIME_P)) % SAFE_PRIME_P) {
      return false;
    }
    const cDivG = (bp.bitCommitment * INV_G) % SAFE_PRIME_P;
    return modPow(BASE_H, bp.s1, SAFE_PRIME_P) === (bp.a1 * modPow(cDivG, bp.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private proveGap(val: bigint, blinding: bigint, bitLength: number, tag: string): GapProof {
    const commitment = (modPow(BASE_G, val, SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const blindings: bigint[] = [];
    let acc = 0n;
    for (let i = 0; i < bitLength; i++) {
      if (i < bitLength - 1) {
        const ri = randomScalar();
        blindings.push(ri);
        acc = modScalar(acc + (1n << BigInt(i)) * ri);
      } else {
        const invPow2 = modPow((1n << BigInt(i)) % SUBGROUP_Q, SUBGROUP_Q - 2n, SUBGROUP_Q);
        blindings.push(modScalar((blinding - acc) * invPow2));
      }
    }
    const bits: RangeBitOR[] = [];
    for (let i = 0; i < bitLength; i++) {
      const bit = Number((val >> BigInt(i)) & 1n) as 0 | 1;
      bits.push(this.proveBit(bit, blindings[i], `${tag}:b${i}`));
    }
    return { commitment, bitLength, bits };
  }

  private verifyGap(proof: GapProof, tag: string): boolean {
    if (proof.bitLength < 1 || proof.bits.length !== proof.bitLength) return false;
    let acc = 1n;
    for (let i = 0; i < proof.bitLength; i++) {
      if (!this.verifyBit(proof.bits[i], `${tag}:b${i}`)) return false;
      acc = (acc * modPow(proof.bits[i].bitCommitment, 1n << BigInt(i), SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return acc === proof.commitment;
  }

  private computeOrChallenge(
    targetCommitment: bigint,
    intervals: AllowedInterval[],
    branchCommitments: bigint[],
    eqAnnounces: bigint[],
    context: string,
  ): bigint {
    return hashToScalar(
      'RANGE-DISJUNCT-OR-V1',
      context,
      targetCommitment.toString(16),
      ...intervals.map((iv) => `${iv.min.toString()}:${iv.max.toString()}`),
      ...branchCommitments.map((c) => c.toString(16)),
      ...eqAnnounces.map((a) => a.toString(16)),
    );
  }

  public proveMultiIntervalMembership(
    secretValue: bigint,
    secretBlinding: bigint,
    intervals: AllowedInterval[],
    context = 'range-union-v1',
  ): MultiIntervalMembershipProof {
    if (intervals.length === 0) throw new Error('Must specify at least one interval');
    let realIndex = -1;
    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i];
      if (iv.min > iv.max) throw new RangeError(`Invalid interval [${iv.min}, ${iv.max}]`);
      if (realIndex === -1 && secretValue >= iv.min && secretValue <= iv.max) {
        realIndex = i;
      }
    }
    if (realIndex === -1) {
      throw new RangeError(`Secret value ${secretValue} does not belong to any allowed interval`);
    }

    const targetCommitment = this.commit(secretValue, secretBlinding).commitment;
    const branchComms: bigint[] = [];
    const lowerGaps: GapProof[] = [];
    const upperGaps: GapProof[] = [];
    const eqAnnounces: bigint[] = [];
    const eqChallenges = new Array<bigint>(intervals.length).fill(0n);
    const eqResponses = new Array<bigint>(intervals.length).fill(0n);

    let realNonce = 0n;
    let realDeltaBlinding = 0n;
    let simChallengeSum = 0n;

    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i];
      const bits = this.requiredBits(iv.max - iv.min);
      const valForBranch = i === realIndex ? secretValue : iv.min;
      const br = this.commit(valForBranch);
      branchComms.push(br.commitment);
      lowerGaps.push(this.proveGap(valForBranch - iv.min, br.blinding, bits, `${context}:i${i}:lo`));
      upperGaps.push(this.proveGap(iv.max - valForBranch, modScalar(SUBGROUP_Q - br.blinding), bits, `${context}:i${i}:hi`));

      if (i === realIndex) {
        realDeltaBlinding = modScalar(secretBlinding - br.blinding);
        realNonce = randomScalar();
        eqAnnounces.push(modPow(BASE_H, realNonce, SAFE_PRIME_P));
      } else {
        const ci = randomScalar();
        const si = randomScalar();
        eqChallenges[i] = ci;
        eqResponses[i] = si;
        simChallengeSum = modScalar(simChallengeSum + ci);
        // ratio = targetCommitment / branchCommitment
        const ratio = (targetCommitment * modPow(br.commitment, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
        const ai = (modPow(BASE_H, si, SAFE_PRIME_P) * modPow(ratio, modScalar(SUBGROUP_Q - ci), SAFE_PRIME_P)) % SAFE_PRIME_P;
        eqAnnounces.push(ai);
      }
    }

    const orRootChallenge = this.computeOrChallenge(targetCommitment, intervals, branchComms, eqAnnounces, context);
    eqChallenges[realIndex] = modScalar(orRootChallenge - simChallengeSum);
    eqResponses[realIndex] = modScalar(realNonce + eqChallenges[realIndex] * realDeltaBlinding);

    const branches: IntervalBranchProof[] = intervals.map((iv, i) => ({
      min: iv.min,
      max: iv.max,
      branchCommitment: branchComms[i],
      lowerGap: lowerGaps[i],
      upperGap: upperGaps[i],
      eqAnnounceR: eqAnnounces[i],
      eqChallenge: eqChallenges[i],
      eqResponse: eqResponses[i],
    }));

    return {
      targetCommitment,
      intervals: intervals.map((iv) => ({ min: iv.min, max: iv.max })),
      branches,
      orRootChallenge,
      context,
    };
  }

  public verifyMultiIntervalMembership(proof: MultiIntervalMembershipProof): boolean {
    const k = proof.intervals.length;
    if (k === 0 || proof.branches.length !== k) return false;

    const expectedRoot = this.computeOrChallenge(
      proof.targetCommitment,
      proof.intervals,
      proof.branches.map((b) => b.branchCommitment),
      proof.branches.map((b) => b.eqAnnounceR),
      proof.context,
    );
    if (expectedRoot !== proof.orRootChallenge) return false;

    let challengeSum = 0n;
    for (let i = 0; i < k; i++) {
      const iv = proof.intervals[i];
      const br = proof.branches[i];
      if (iv.min > iv.max || br.min !== iv.min || br.max !== iv.max) return false;

      // Verify lower gap: branchCommitment * g^{-min}
      const expLo = (br.branchCommitment * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(iv.min)), SAFE_PRIME_P)) % SAFE_PRIME_P;
      if (br.lowerGap.commitment !== expLo || !this.verifyGap(br.lowerGap, `${proof.context}:i${i}:lo`)) return false;

      // Verify upper gap: g^{max} * branchCommitment^{-1}
      const invBr = modPow(br.branchCommitment, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
      const expHi = (modPow(BASE_G, modScalar(iv.max), SAFE_PRIME_P) * invBr) % SAFE_PRIME_P;
      if (br.upperGap.commitment !== expHi || !this.verifyGap(br.upperGap, `${proof.context}:i${i}:hi`)) return false;

      // Verify equality disjunction equation: h^{eqResponse} == eqAnnounceR * (target / branch)^{eqChallenge}
      const ratio = (proof.targetCommitment * invBr) % SAFE_PRIME_P;
      const lhs = modPow(BASE_H, br.eqResponse, SAFE_PRIME_P);
      const rhs = (br.eqAnnounceR * modPow(ratio, br.eqChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
      if (lhs !== rhs) return false;

      challengeSum = modScalar(challengeSum + br.eqChallenge);
    }

    return challengeSum === proof.orRootChallenge;
  }

  public verifyBatch(proofs: MultiIntervalMembershipProof[]): { allValid: boolean; failedIndices: number[] } {
    const failedIndices: number[] = [];
    for (let i = 0; i < proofs.length; i++) {
      if (!this.verifyMultiIntervalMembership(proofs[i])) failedIndices.push(i);
    }
    return { allValid: failedIndices.length === 0, failedIndices };
  }

  public serializeProof(proof: MultiIntervalMembershipProof): string {
    return JSON.stringify({
      intervalCount: proof.intervals.length,
      targetCommitment: proof.targetCommitment.toString(16),
      context: proof.context,
    });
  }
}
