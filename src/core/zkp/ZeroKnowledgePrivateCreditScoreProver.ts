import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Private Credit Score & Tier Eligibility Prover.
 *
 * Allows an applicant to prove they meet a lender's minimum weighted credit score cutoff
 * WITHOUT revealing ANY individual financial factor (income, utilization, payment history,
 * account age) or even their exact final credit score:
 *  - Lender publishes scoring rubric: weights w_i >= 0, per-factor bounds [min_i, max_i],
 *    baseOffset B, and tierCutoff T.
 *  - Applicant commits each hidden factor C_i = g^{f_i} * h^{r_i} mod P with range proofs
 *    certifying min_i <= f_i <= max_i (preventing factor overflow!).
 *  - Verifier homomorphically computes hidden score commitment:
 *      C_score = g^B * prod(C_i^{w_i}) = g^{B + sum w_i f_i} * h^{sum w_i r_i}
 *  - Applicant proves score >= tierCutoff via a bit-decomposition OR-proof on surplus
 *    (score - tierCutoff >= 0) without exposing the score or any underlying factor!
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
  const raw = (BigInt('0x' + sha256Hex('ZK-CREDIT-SCORE-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();
const INV_G = modPow(BASE_G, SAFE_PRIME_P - 2n, SAFE_PRIME_P);

export interface ScoringFactorRule {
  factorId: string;
  weight: bigint;
  minVal: bigint;
  maxVal: bigint;
}

export interface CreditScoringRubric {
  rubricId: string;
  baseOffset: bigint;
  tierCutoff: bigint;
  factors: ScoringFactorRule[];
}

export interface ScoreBitOR {
  bitCommitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  s0: bigint;
  s1: bigint;
}

export interface NonNegativeGap {
  commitment: bigint;
  bitLength: number;
  bits: ScoreBitOR[];
}

export interface FactorCommitmentProof {
  factorId: string;
  commitment: bigint;
  lowerGap: NonNegativeGap;
  upperGap: NonNegativeGap;
}

export interface PrivateCreditEligibilityProof {
  rubricId: string;
  applicantPseudonym: string;
  tierCutoff: bigint;
  scoreCommitment: bigint;
  factorProofs: FactorCommitmentProof[];
  surplusProof: NonNegativeGap; // proves score - tierCutoff >= 0
}

export class ZeroKnowledgePrivateCreditScoreProver {
  private requiredBits(span: bigint): number {
    return span <= 0n ? 1 : span.toString(2).length;
  }

  private commit(val: bigint, blinding?: bigint): { commitment: bigint; blinding: bigint } {
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    return {
      commitment: (modPow(BASE_G, modScalar(val), SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P,
      blinding: r,
    };
  }

  private proveBit(bit: 0 | 1, blinding: bigint, tag: string): ScoreBitOR {
    const bitCommitment = (modPow(BASE_G, BigInt(bit), SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const cDivG = (bitCommitment * INV_G) % SAFE_PRIME_P;
    if (bit === 0) {
      const k0 = randomScalar();
      const a0 = modPow(BASE_H, k0, SAFE_PRIME_P);
      const c1 = randomScalar();
      const s1 = randomScalar();
      const a1 = (modPow(BASE_H, s1, SAFE_PRIME_P) * modPow(cDivG, modScalar(SUBGROUP_Q - c1), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const e = hashToScalar('CREDIT-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c0 = modScalar(e - c1);
      const s0 = modScalar(k0 + c0 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    } else {
      const c0 = randomScalar();
      const s0 = randomScalar();
      const a0 = (modPow(BASE_H, s0, SAFE_PRIME_P) * modPow(bitCommitment, modScalar(SUBGROUP_Q - c0), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const k1 = randomScalar();
      const a1 = modPow(BASE_H, k1, SAFE_PRIME_P);
      const e = hashToScalar('CREDIT-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c1 = modScalar(e - c0);
      const s1 = modScalar(k1 + c1 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    }
  }

  private verifyBit(bp: ScoreBitOR, tag: string): boolean {
    const e = hashToScalar('CREDIT-BIT-V1', bp.bitCommitment.toString(16), bp.a0.toString(16), bp.a1.toString(16), tag);
    if (modScalar(bp.c0 + bp.c1) !== e) return false;
    if (modPow(BASE_H, bp.s0, SAFE_PRIME_P) !== (bp.a0 * modPow(bp.bitCommitment, bp.c0, SAFE_PRIME_P)) % SAFE_PRIME_P) return false;
    const cDivG = (bp.bitCommitment * INV_G) % SAFE_PRIME_P;
    return modPow(BASE_H, bp.s1, SAFE_PRIME_P) === (bp.a1 * modPow(cDivG, bp.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private proveGap(val: bigint, blinding: bigint, bitLength: number, tag: string): NonNegativeGap {
    if (val < 0n || val >= (1n << BigInt(bitLength))) throw new RangeError(`Gap ${val} outside [0, 2^${bitLength})`);
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
    const bits = Array.from({ length: bitLength }, (_, i) =>
      this.proveBit(Number((val >> BigInt(i)) & 1n) as 0 | 1, blindings[i], `${tag}:b${i}`),
    );
    return { commitment, bitLength, bits };
  }

  private verifyGap(gap: NonNegativeGap, tag: string): boolean {
    if (gap.bitLength < 1 || gap.bits.length !== gap.bitLength) return false;
    let acc = 1n;
    for (let i = 0; i < gap.bitLength; i++) {
      if (!this.verifyBit(gap.bits[i], `${tag}:b${i}`)) return false;
      acc = (acc * modPow(gap.bits[i].bitCommitment, 1n << BigInt(i), SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return acc === gap.commitment;
  }

  public computeMaxPossibleScore(rubric: CreditScoringRubric): bigint {
    let maxScore = rubric.baseOffset;
    for (const f of rubric.factors) maxScore += f.weight * f.maxVal;
    return maxScore;
  }

  public proveCreditEligibility(
    rubric: CreditScoringRubric,
    applicantPseudonym: string,
    secretFactorValues: Record<string, bigint>,
  ): PrivateCreditEligibilityProof {
    if (rubric.factors.length === 0) throw new Error('Rubric must specify at least one scoring factor');

    const factorProofs: FactorCommitmentProof[] = [];
    let totalScore = rubric.baseOffset;
    let totalBlinding = 0n;
    let scoreCommitment = modPow(BASE_G, modScalar(rubric.baseOffset), SAFE_PRIME_P);

    for (const rule of rubric.factors) {
      if (rule.weight < 0n || rule.minVal > rule.maxVal) throw new RangeError(`Invalid rubric rule "${rule.factorId}"`);
      const val = secretFactorValues[rule.factorId];
      if (val === undefined) throw new Error(`Missing secret factor value for "${rule.factorId}"`);
      if (val < rule.minVal || val > rule.maxVal) {
        throw new RangeError(`Factor "${rule.factorId}" value ${val} outside [${rule.minVal}, ${rule.maxVal}]`);
      }

      const { commitment, blinding } = this.commit(val);
      const bits = this.requiredBits(rule.maxVal - rule.minVal);
      const lowerGap = this.proveGap(val - rule.minVal, blinding, bits, `${rubric.rubricId}:${applicantPseudonym}:${rule.factorId}:lo`);
      const upperGap = this.proveGap(
        rule.maxVal - val,
        modScalar(SUBGROUP_Q - blinding),
        bits,
        `${rubric.rubricId}:${applicantPseudonym}:${rule.factorId}:hi`,
      );

      factorProofs.push({ factorId: rule.factorId, commitment, lowerGap, upperGap });
      totalScore += rule.weight * val;
      totalBlinding = modScalar(totalBlinding + modScalar(rule.weight) * blinding);
      scoreCommitment = (scoreCommitment * modPow(commitment, rule.weight, SAFE_PRIME_P)) % SAFE_PRIME_P;
    }

    if (totalScore < rubric.tierCutoff) {
      throw new Error(`Applicant score ${totalScore} is below required tierCutoff ${rubric.tierCutoff}`);
    }

    const maxPossible = this.computeMaxPossibleScore(rubric);
    const surplusBits = this.requiredBits(maxPossible - rubric.tierCutoff);
    const surplusProof = this.proveGap(
      totalScore - rubric.tierCutoff,
      totalBlinding,
      surplusBits,
      `${rubric.rubricId}:${applicantPseudonym}:surplus:${rubric.tierCutoff.toString()}`,
    );

    return {
      rubricId: rubric.rubricId,
      applicantPseudonym,
      tierCutoff: rubric.tierCutoff,
      scoreCommitment,
      factorProofs,
      surplusProof,
    };
  }

  public verifyCreditEligibility(rubric: CreditScoringRubric, proof: PrivateCreditEligibilityProof): boolean {
    if (proof.rubricId !== rubric.rubricId || proof.tierCutoff !== rubric.tierCutoff) return false;
    if (proof.factorProofs.length !== rubric.factors.length) return false;

    let computedScoreComm = modPow(BASE_G, modScalar(rubric.baseOffset), SAFE_PRIME_P);
    for (let i = 0; i < rubric.factors.length; i++) {
      const rule = rubric.factors[i];
      const fp = proof.factorProofs[i];
      if (fp.factorId !== rule.factorId) return false;

      const expLo = (fp.commitment * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(rule.minVal)), SAFE_PRIME_P)) % SAFE_PRIME_P;
      if (fp.lowerGap.commitment !== expLo || !this.verifyGap(fp.lowerGap, `${rubric.rubricId}:${proof.applicantPseudonym}:${rule.factorId}:lo`)) {
        return false;
      }

      const invC = modPow(fp.commitment, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
      const expHi = (modPow(BASE_G, modScalar(rule.maxVal), SAFE_PRIME_P) * invC) % SAFE_PRIME_P;
      if (fp.upperGap.commitment !== expHi || !this.verifyGap(fp.upperGap, `${rubric.rubricId}:${proof.applicantPseudonym}:${rule.factorId}:hi`)) {
        return false;
      }

      computedScoreComm = (computedScoreComm * modPow(fp.commitment, rule.weight, SAFE_PRIME_P)) % SAFE_PRIME_P;
    }

    if (computedScoreComm !== proof.scoreCommitment) return false;

    const expSurplus = (proof.scoreCommitment * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(rubric.tierCutoff)), SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (proof.surplusProof.commitment !== expSurplus) return false;
    return this.verifyGap(
      proof.surplusProof,
      `${rubric.rubricId}:${proof.applicantPseudonym}:surplus:${rubric.tierCutoff.toString()}`,
    );
  }

  public serializeProof(proof: PrivateCreditEligibilityProof): string {
    return JSON.stringify({
      rubricId: proof.rubricId,
      applicantPseudonym: proof.applicantPseudonym,
      tierCutoff: proof.tierCutoff.toString(),
      factorCount: proof.factorProofs.length,
    });
  }
}
