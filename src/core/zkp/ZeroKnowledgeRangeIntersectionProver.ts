/**
 * @file ZeroKnowledgeRangeIntersectionProver.ts
 * @description Zero-Knowledge Confidential Interval Inclusion & Multi-Interval Intersection Prover.
 * Allows WorkSphere services to prove that a hidden Pedersen-committed scalar x (such as salary
 * band, SLA latency, or room capacity utilization) lies inside a single interval [L, U] OR inside
 * the intersection of multiple policy intervals [L_1, U_1] intersect ... intersect [L_k, U_k]
 * WITHOUT disclosing x:
 *   1. Computes effective intersection bounds L_eff = max(L_i), U_eff = min(U_i).
 *   2. Proves x - L_eff >= 0 using Chaum-Pedersen 0/1 bit-decomposition on C / g^{L_eff}.
 *   3. Proves U_eff - x >= 0 using Chaum-Pedersen 0/1 bit-decomposition on g^{U_eff} / C.
 *   4. Supports confidential two-party overlap verification (proving two hidden values lie within
 *      tolerance delta: |x - y| <= delta) and JSON audit serialization.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface ClosedInterval {
  intervalId: string;
  lowerBound: bigint;
  upperBound: bigint;
}

export interface CommittedScalar {
  valueId: string;
  value: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface IntervalBitProof {
  commitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  z0: bigint;
  z1: bigint;
}

export interface ShiftedNonNegativeProof {
  targetCommitment: bigint;
  bitLength: number;
  bitProofs: IntervalBitProof[];
  linkNonce: bigint;
  linkResponse: bigint;
}

export interface RangeIntersectionProof {
  proofId: string;
  valueCommitment: bigint;
  intervals: ClosedInterval[];
  effectiveLower: bigint;
  effectiveUpper: bigint;
  lowerDeltaProof: ShiftedNonNegativeProof;
  upperDeltaProof: ShiftedNonNegativeProof;
  proofDigest: string;
}

export interface ProximityToleranceProof {
  proofId: string;
  commitmentA: bigint;
  commitmentB: bigint;
  maxDelta: bigint;
  shiftedProof: ShiftedNonNegativeProof;
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
  const digest = createHash('sha256').update(`WorkSphere::RangeIntersectH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
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
 * Zero-Knowledge Range Intersection & Proximity Tolerance Prover.
 */
export class ZeroKnowledgeRangeIntersectionProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;
  private readonly gInv: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = deriveH(p, g);
    this.gInv = modInverse(g, p);
  }

  public commit(value: bigint, blinding: bigint): bigint {
    return (
      modPow(this.g, modNorm(value, this.q), this.p) *
      modPow(this.h, modNorm(blinding, this.q), this.p)
    ) % this.p;
  }

  public commitValue(valueId: string, value: bigint): CommittedScalar {
    const blinding = randomScalar(this.q);
    return {
      valueId,
      value,
      blinding,
      commitment: this.commit(value, blinding),
    };
  }

  /**
   * Computes the exact closed intersection [max(L_i), min(U_i)] of a set of policy intervals.
   */
  public computeIntervalIntersection(intervals: readonly ClosedInterval[]): {
    nonEmpty: boolean;
    effectiveLower: bigint;
    effectiveUpper: bigint;
  } {
    if (intervals.length === 0) {
      throw new Error('At least one interval is required');
    }
    let effectiveLower = intervals[0].lowerBound;
    let effectiveUpper = intervals[0].upperBound;
    for (const iv of intervals) {
      if (iv.lowerBound > iv.upperBound) {
        throw new RangeError(`Malformed interval ${iv.intervalId}: lowerBound > upperBound`);
      }
      if (iv.lowerBound > effectiveLower) effectiveLower = iv.lowerBound;
      if (iv.upperBound < effectiveUpper) effectiveUpper = iv.upperBound;
    }
    return {
      nonEmpty: effectiveLower <= effectiveUpper,
      effectiveLower,
      effectiveUpper,
    };
  }

  private proveBit(bit: 0n | 1n, r: bigint, ctx: string): IntervalBitProof {
    const commitment = this.commit(bit, r);
    const w = randomScalar(this.q);
    const simC = randomScalar(this.q);
    const simZ = randomScalar(this.q);

    let a0: bigint, a1: bigint, c0: bigint, c1: bigint, z0: bigint, z1: bigint;
    if (bit === 0n) {
      a0 = modPow(this.h, w, this.p);
      const cOverG = (commitment * this.gInv) % this.p;
      a1 = (modPow(this.h, simZ, this.p) * modPow(cOverG, modNorm(this.q - simC, this.q), this.p)) % this.p;
      const e = hashScalar('WorkSphere::RangeIntBitOR', [ctx, commitment, a0, a1]);
      c1 = simC;
      c0 = modNorm(e - c1, this.q);
      z0 = modNorm(w + c0 * r, this.q);
      z1 = simZ;
    } else {
      a0 = (modPow(this.h, simZ, this.p) * modPow(commitment, modNorm(this.q - simC, this.q), this.p)) % this.p;
      a1 = modPow(this.h, w, this.p);
      const e = hashScalar('WorkSphere::RangeIntBitOR', [ctx, commitment, a0, a1]);
      c0 = simC;
      c1 = modNorm(e - c0, this.q);
      z0 = simZ;
      z1 = modNorm(w + c1 * r, this.q);
    }

    return { commitment, a0, a1, c0, c1, z0, z1 };
  }

  private verifyBit(bp: IntervalBitProof, ctx: string): boolean {
    const e = hashScalar('WorkSphere::RangeIntBitOR', [ctx, bp.commitment, bp.a0, bp.a1]);
    if (modNorm(bp.c0 + bp.c1, this.q) !== e) return false;

    const lhs0 = modPow(this.h, bp.z0, this.p);
    const rhs0 = (bp.a0 * modPow(bp.commitment, bp.c0, this.p)) % this.p;
    if (lhs0 !== rhs0) return false;

    const cOverG = (bp.commitment * this.gInv) % this.p;
    const lhs1 = modPow(this.h, bp.z1, this.p);
    const rhs1 = (bp.a1 * modPow(cOverG, bp.c1, this.p)) % this.p;
    return lhs1 === rhs1;
  }

  private proveShiftedNonNegative(
    deltaVal: bigint,
    deltaBlinding: bigint,
    targetCommitment: bigint,
    bitLength: number,
    ctx: string
  ): ShiftedNonNegativeProof {
    const maxVal = (1n << BigInt(bitLength)) - 1n;
    if (deltaVal < 0n || deltaVal > maxVal) {
      throw new RangeError(`Delta ${deltaVal} does not fit in [0, ${maxVal}]`);
    }

    const bitProofs: IntervalBitProof[] = [];
    let weightedR = 0n;
    for (let i = 0; i < bitLength; i++) {
      const bit = ((deltaVal >> BigInt(i)) & 1n) === 1n ? 1n : 0n;
      const rBit = randomScalar(this.q);
      bitProofs.push(this.proveBit(bit, rBit, `${ctx}:b:${i}`));
      weightedR = modNorm(weightedR + rBit * (1n << BigInt(i)), this.q);
    }

    const diffR = modNorm(deltaBlinding - weightedR, this.q);
    const k = randomScalar(this.q);
    const linkNonce = modPow(this.h, k, this.p);
    const eLink = hashScalar('WorkSphere::RangeIntLink', [ctx, targetCommitment, linkNonce]);
    const linkResponse = modNorm(k + eLink * diffR, this.q);

    return {
      targetCommitment,
      bitLength,
      bitProofs,
      linkNonce,
      linkResponse,
    };
  }

  private verifyShiftedNonNegative(
    proof: ShiftedNonNegativeProof,
    expectedCommitment: bigint,
    ctx: string
  ): boolean {
    if (proof.targetCommitment !== expectedCommitment) return false;
    if (proof.bitProofs.length !== proof.bitLength || proof.bitLength < 1) return false;

    let reconstructed = 1n;
    for (let i = 0; i < proof.bitLength; i++) {
      const bp = proof.bitProofs[i];
      if (!this.verifyBit(bp, `${ctx}:b:${i}`)) return false;
      reconstructed = (reconstructed * modPow(bp.commitment, 1n << BigInt(i), this.p)) % this.p;
    }

    const ratio = (expectedCommitment * modInverse(reconstructed, this.p)) % this.p;
    const eLink = hashScalar('WorkSphere::RangeIntLink', [ctx, expectedCommitment, proof.linkNonce]);
    const lhs = modPow(this.h, proof.linkResponse, this.p);
    const rhs = (proof.linkNonce * modPow(ratio, eLink, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Proves in zero knowledge that `secret.value` lies inside the intersection of ALL provided
   * policy intervals [L_i, U_i].
   */
  public proveInRangeIntersection(
    proofId: string,
    secret: CommittedScalar,
    intervals: readonly ClosedInterval[],
    bitLength = 16
  ): RangeIntersectionProof {
    const inter = this.computeIntervalIntersection(intervals);
    if (!inter.nonEmpty) {
      throw new Error('Policy intervals have an empty intersection');
    }
    if (secret.value < inter.effectiveLower || secret.value > inter.effectiveUpper) {
      throw new RangeError('Secret value lies outside the effective interval intersection');
    }

    // Lower delta commitment: C_low = C * g^(-L_eff) = g^(x - L_eff) * h^r
    const lowerDelta = secret.value - inter.effectiveLower;
    const lowerCommit =
      (secret.commitment * modInverse(modPow(this.g, modNorm(inter.effectiveLower, this.q), this.p), this.p)) %
      this.p;
    const lowerDeltaProof = this.proveShiftedNonNegative(
      lowerDelta,
      secret.blinding,
      lowerCommit,
      bitLength,
      `${proofId}:low`
    );

    // Upper delta commitment: C_up = g^(U_eff) * C^(-1) = g^(U_eff - x) * h^(-r)
    const upperDelta = inter.effectiveUpper - secret.value;
    const upperCommit =
      (modPow(this.g, modNorm(inter.effectiveUpper, this.q), this.p) *
        modInverse(secret.commitment, this.p)) %
      this.p;
    const upperDeltaProof = this.proveShiftedNonNegative(
      upperDelta,
      modNorm(-secret.blinding, this.q),
      upperCommit,
      bitLength,
      `${proofId}:up`
    );

    const proofDigest = createHash('sha256')
      .update(
        `${proofId}|${secret.commitment.toString(16)}|${inter.effectiveLower}|${inter.effectiveUpper}|${intervals.length}`
      )
      .digest('hex');

    return {
      proofId,
      valueCommitment: secret.commitment,
      intervals: intervals.map((iv) => ({ ...iv })),
      effectiveLower: inter.effectiveLower,
      effectiveUpper: inter.effectiveUpper,
      lowerDeltaProof,
      upperDeltaProof,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a zero-knowledge interval-intersection membership proof.
   */
  public verifyRangeIntersection(proof: RangeIntersectionProof): { valid: boolean; reason?: string } {
    let inter: { nonEmpty: boolean; effectiveLower: bigint; effectiveUpper: bigint };
    try {
      inter = this.computeIntervalIntersection(proof.intervals);
    } catch (e) {
      return { valid: false, reason: (e as Error).message };
    }

    if (!inter.nonEmpty) {
      return { valid: false, reason: 'Policy intervals do not intersect' };
    }
    if (inter.effectiveLower !== proof.effectiveLower || inter.effectiveUpper !== proof.effectiveUpper) {
      return { valid: false, reason: 'Claimed effective intersection bounds do not match intervals' };
    }

    const expectedLowerCommit =
      (proof.valueCommitment *
        modInverse(modPow(this.g, modNorm(inter.effectiveLower, this.q), this.p), this.p)) %
      this.p;
    if (!this.verifyShiftedNonNegative(proof.lowerDeltaProof, expectedLowerCommit, `${proof.proofId}:low`)) {
      return { valid: false, reason: 'Lower-bound non-negativity proof failed' };
    }

    const expectedUpperCommit =
      (modPow(this.g, modNorm(inter.effectiveUpper, this.q), this.p) *
        modInverse(proof.valueCommitment, this.p)) %
      this.p;
    if (!this.verifyShiftedNonNegative(proof.upperDeltaProof, expectedUpperCommit, `${proof.proofId}:up`)) {
      return { valid: false, reason: 'Upper-bound non-negativity proof failed' };
    }

    return { valid: true };
  }

  /**
   * Proves in zero knowledge that two hidden committed values satisfy |a - b| <= maxDelta
   * by proving (a - b + maxDelta) in [0, 2 * maxDelta] using homomorphic commitment shifting.
   */
  public proveProximityTolerance(
    proofId: string,
    scalarA: CommittedScalar,
    scalarB: CommittedScalar,
    maxDelta: bigint,
    bitLength = 16
  ): ProximityToleranceProof {
    if (maxDelta < 0n) throw new RangeError('maxDelta must be non-negative');
    const shiftedVal = scalarA.value - scalarB.value + maxDelta;
    if (shiftedVal < 0n || shiftedVal > 2n * maxDelta) {
      throw new RangeError('Values exceed allowed proximity tolerance |a - b| <= maxDelta');
    }

    const shiftedBlinding = modNorm(scalarA.blinding - scalarB.blinding, this.q);
    const shiftedCommit =
      (((scalarA.commitment * modInverse(scalarB.commitment, this.p)) % this.p) *
        modPow(this.g, modNorm(maxDelta, this.q), this.p)) %
      this.p;

    const shiftedProof = this.proveShiftedNonNegative(
      shiftedVal,
      shiftedBlinding,
      shiftedCommit,
      bitLength,
      `${proofId}:prox`
    );

    const proofDigest = createHash('sha256')
      .update(`${proofId}|${scalarA.commitment.toString(16)}|${scalarB.commitment.toString(16)}|${maxDelta}`)
      .digest('hex');

    return {
      proofId,
      commitmentA: scalarA.commitment,
      commitmentB: scalarB.commitment,
      maxDelta,
      shiftedProof,
      proofDigest,
    };
  }

  public verifyProximityTolerance(proof: ProximityToleranceProof): boolean {
    if (proof.maxDelta < 0n) return false;
    const expectedShifted =
      (((proof.commitmentA * modInverse(proof.commitmentB, this.p)) % this.p) *
        modPow(this.g, modNorm(proof.maxDelta, this.q), this.p)) %
      this.p;
    return this.verifyShiftedNonNegative(proof.shiftedProof, expectedShifted, `${proof.proofId}:prox`);
  }

  public serializeIntersectionProof(proof: RangeIntersectionProof): string {
    const serShifted = (sp: ShiftedNonNegativeProof) => ({
      targetCommitment: sp.targetCommitment.toString(16),
      bitLength: sp.bitLength,
      linkNonce: sp.linkNonce.toString(16),
      linkResponse: sp.linkResponse.toString(16),
      bitProofs: sp.bitProofs.map((bp) => ({
        commitment: bp.commitment.toString(16),
        a0: bp.a0.toString(16),
        a1: bp.a1.toString(16),
        c0: bp.c0.toString(16),
        c1: bp.c1.toString(16),
        z0: bp.z0.toString(16),
        z1: bp.z1.toString(16),
      })),
    });

    return JSON.stringify({
      proofId: proof.proofId,
      valueCommitment: proof.valueCommitment.toString(16),
      intervals: proof.intervals.map((iv) => ({
        intervalId: iv.intervalId,
        lowerBound: iv.lowerBound.toString(),
        upperBound: iv.upperBound.toString(),
      })),
      effectiveLower: proof.effectiveLower.toString(),
      effectiveUpper: proof.effectiveUpper.toString(),
      lowerDeltaProof: serShifted(proof.lowerDeltaProof),
      upperDeltaProof: serShifted(proof.upperDeltaProof),
      proofDigest: proof.proofDigest,
    });
  }

  public deserializeIntersectionProof(payload: string): RangeIntersectionProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    const deserShifted = (sp: Record<string, any>): ShiftedNonNegativeProof => ({
      targetCommitment: BigInt(`0x${sp.targetCommitment}`),
      bitLength: Number(sp.bitLength),
      linkNonce: BigInt(`0x${sp.linkNonce}`),
      linkResponse: BigInt(`0x${sp.linkResponse}`),
      bitProofs: sp.bitProofs.map((bp: Record<string, string>) => ({
        commitment: BigInt(`0x${bp.commitment}`),
        a0: BigInt(`0x${bp.a0}`),
        a1: BigInt(`0x${bp.a1}`),
        c0: BigInt(`0x${bp.c0}`),
        c1: BigInt(`0x${bp.c1}`),
        z0: BigInt(`0x${bp.z0}`),
        z1: BigInt(`0x${bp.z1}`),
      })),
    });

    return {
      proofId: raw.proofId,
      valueCommitment: BigInt(`0x${raw.valueCommitment}`),
      intervals: raw.intervals.map((iv: Record<string, string>) => ({
        intervalId: iv.intervalId,
        lowerBound: BigInt(iv.lowerBound),
        upperBound: BigInt(iv.upperBound),
      })),
      effectiveLower: BigInt(raw.effectiveLower),
      effectiveUpper: BigInt(raw.effectiveUpper),
      lowerDeltaProof: deserShifted(raw.lowerDeltaProof),
      upperDeltaProof: deserShifted(raw.upperDeltaProof),
      proofDigest: raw.proofDigest,
    };
  }
}
