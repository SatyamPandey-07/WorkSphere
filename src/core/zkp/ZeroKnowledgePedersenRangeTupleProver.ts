import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Pedersen Range Tuple Prover.
 *
 * Proves simultaneously in zero knowledge that:
 *  1. Each committed coordinate C_i = g^{v_i} * h^{r_i} satisfies L_i <= v_i <= U_i
 *     (via bit-decomposition OR-proofs on both (v_i - L_i) and (U_i - v_i)).
 *  2. The weighted sum sum(w_i * v_i) lies within [sumMin, sumMax] via homomorphic
 *     commitment combination prod(C_i^{w_i}) = g^{sum(w_i * v_i)} * h^{sum(w_i * r_i)}.
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

function hashToScalar(...parts: string[]): bigint {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return modScalar(BigInt('0x' + h.digest('hex').slice(0, 32)));
}

function deriveH(): bigint {
  const h = createHash('sha256').update('ZK-PEDERSEN-RANGE-TUPLE-H-V1').digest('hex');
  const raw = (BigInt('0x' + h.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();
const INV_G = modPow(BASE_G, SAFE_PRIME_P - 2n, SAFE_PRIME_P);

export interface BitDisjunctionProof {
  bitCommitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  s0: bigint;
  s1: bigint;
}

export interface NonNegativeBitProof {
  targetCommitment: bigint;
  bitLength: number;
  bitProofs: BitDisjunctionProof[];
}

export interface CoordinateRangeSpec {
  name: string;
  value: bigint;
  min: bigint;
  max: bigint;
  weight: bigint;
}

export interface CoordinateRangeProof {
  name: string;
  commitment: bigint;
  min: bigint;
  max: bigint;
  weight: bigint;
  lowerGapProof: NonNegativeBitProof;
  upperGapProof: NonNegativeBitProof;
}

export interface RangeTupleProof {
  coordinates: CoordinateRangeProof[];
  weightedSumCommitment: bigint;
  sumMin: bigint;
  sumMax: bigint;
  sumLowerGapProof: NonNegativeBitProof;
  sumUpperGapProof: NonNegativeBitProof;
  context: string;
}

export class ZeroKnowledgePedersenRangeTupleProver {
  public commit(value: bigint, blinding?: bigint): { commitment: bigint; blinding: bigint } {
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, modScalar(value), SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { commitment, blinding: r };
  }

  private bitChallenge(bitComm: bigint, a0: bigint, a1: bigint, tag: string): bigint {
    return hashToScalar('BIT-OR-V1', bitComm.toString(16), a0.toString(16), a1.toString(16), tag);
  }

  private proveBit(bit: 0 | 1, blinding: bigint, tag: string): BitDisjunctionProof {
    const bitCommitment = (modPow(BASE_G, BigInt(bit), SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const cDivG = (bitCommitment * INV_G) % SAFE_PRIME_P;

    if (bit === 0) {
      // Real branch 0: bitCommitment = h^r; Simulated branch 1: bitCommitment * g^{-1} = h^r
      const k0 = randomScalar();
      const a0 = modPow(BASE_H, k0, SAFE_PRIME_P);
      const c1 = randomScalar();
      const s1 = randomScalar();
      const a1 = (modPow(BASE_H, s1, SAFE_PRIME_P) * modPow(cDivG, modScalar(SUBGROUP_Q - c1), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const e = this.bitChallenge(bitCommitment, a0, a1, tag);
      const c0 = modScalar(e - c1);
      const s0 = modScalar(k0 + c0 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    } else {
      // Simulated branch 0; Real branch 1
      const c0 = randomScalar();
      const s0 = randomScalar();
      const a0 = (modPow(BASE_H, s0, SAFE_PRIME_P) * modPow(bitCommitment, modScalar(SUBGROUP_Q - c0), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const k1 = randomScalar();
      const a1 = modPow(BASE_H, k1, SAFE_PRIME_P);
      const e = this.bitChallenge(bitCommitment, a0, a1, tag);
      const c1 = modScalar(e - c0);
      const s1 = modScalar(k1 + c1 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    }
  }

  private verifyBit(bp: BitDisjunctionProof, tag: string): boolean {
    const e = this.bitChallenge(bp.bitCommitment, bp.a0, bp.a1, tag);
    if (modScalar(bp.c0 + bp.c1) !== e) return false;

    const lhs0 = modPow(BASE_H, bp.s0, SAFE_PRIME_P);
    const rhs0 = (bp.a0 * modPow(bp.bitCommitment, bp.c0, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhs0 !== rhs0) return false;

    const cDivG = (bp.bitCommitment * INV_G) % SAFE_PRIME_P;
    const lhs1 = modPow(BASE_H, bp.s1, SAFE_PRIME_P);
    const rhs1 = (bp.a1 * modPow(cDivG, bp.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs1 === rhs1;
  }

  private requiredBits(maxValue: bigint): number {
    if (maxValue <= 0n) return 1;
    return maxValue.toString(2).length;
  }

  public proveNonNegative(value: bigint, blinding: bigint, bitLength: number, tag: string): NonNegativeBitProof {
    if (value < 0n || value >= (1n << BigInt(bitLength))) {
      throw new RangeError(`Value ${value} does not fit in ${bitLength} unsigned bits`);
    }
    const targetCommitment = (modPow(BASE_G, value, SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const bitProofs: BitDisjunctionProof[] = [];

    // Choose random blindings for bits 0..bitLength-2, and set the last blinding so sum(2^i * r_i) == blinding mod Q
    let weightedBlindingAcc = 0n;
    const blindings: bigint[] = [];
    for (let i = 0; i < bitLength; i++) {
      if (i < bitLength - 1) {
        const ri = randomScalar();
        blindings.push(ri);
        weightedBlindingAcc = modScalar(weightedBlindingAcc + (1n << BigInt(i)) * ri);
      } else {
        // Solve 2^{bitLength-1} * r_last = (blinding - weightedBlindingAcc) mod Q
        const pow2 = 1n << BigInt(i);
        const invPow2 = modPow(pow2 % SUBGROUP_Q, SUBGROUP_Q - 2n, SUBGROUP_Q);
        const rLast = modScalar((blinding - weightedBlindingAcc) * invPow2);
        blindings.push(rLast);
      }
    }

    for (let i = 0; i < bitLength; i++) {
      const bit = Number((value >> BigInt(i)) & 1n) as 0 | 1;
      bitProofs.push(this.proveBit(bit, blindings[i], `${tag}:bit-${i}`));
    }

    return { targetCommitment, bitLength, bitProofs };
  }

  public verifyNonNegative(proof: NonNegativeBitProof, tag: string): boolean {
    if (proof.bitLength < 1 || proof.bitProofs.length !== proof.bitLength) return false;
    let reconstructed = 1n;
    for (let i = 0; i < proof.bitLength; i++) {
      const bp = proof.bitProofs[i];
      if (!this.verifyBit(bp, `${tag}:bit-${i}`)) return false;
      const weight = 1n << BigInt(i);
      reconstructed = (reconstructed * modPow(bp.bitCommitment, weight, SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return reconstructed === proof.targetCommitment;
  }

  public proveRangeTuple(
    specs: CoordinateRangeSpec[],
    sumMin: bigint,
    sumMax: bigint,
    context = 'tuple-v1',
  ): RangeTupleProof {
    if (specs.length === 0) throw new Error('Tuple must contain at least one coordinate');
    if (sumMin > sumMax) throw new RangeError('sumMin cannot exceed sumMax');

    const coordinates: CoordinateRangeProof[] = [];
    let weightedSumValue = 0n;
    let weightedSumBlinding = 0n;
    let weightedSumCommitment = 1n;

    for (let idx = 0; idx < specs.length; idx++) {
      const s = specs[idx];
      if (s.min > s.max || s.value < s.min || s.value > s.max || s.weight < 0n) {
        throw new RangeError(`Coordinate ${s.name} violates range or weight constraints`);
      }
      const { commitment, blinding } = this.commit(s.value);
      const bits = this.requiredBits(s.max - s.min);

      // Lower gap: (v - min) with blinding r
      const lowerGapProof = this.proveNonNegative(s.value - s.min, blinding, bits, `${context}:c${idx}:lo`);
      // Upper gap: (max - v) with blinding (-r mod Q)
      const upperGapProof = this.proveNonNegative(s.max - s.value, modScalar(SUBGROUP_Q - blinding), bits, `${context}:c${idx}:hi`);

      coordinates.push({
        name: s.name,
        commitment,
        min: s.min,
        max: s.max,
        weight: s.weight,
        lowerGapProof,
        upperGapProof,
      });

      weightedSumValue += s.weight * s.value;
      weightedSumBlinding = modScalar(weightedSumBlinding + modScalar(s.weight) * blinding);
      weightedSumCommitment = (weightedSumCommitment * modPow(commitment, s.weight, SAFE_PRIME_P)) % SAFE_PRIME_P;
    }

    if (weightedSumValue < sumMin || weightedSumValue > sumMax) {
      throw new RangeError(`Weighted sum ${weightedSumValue} is outside [${sumMin}, ${sumMax}]`);
    }

    const sumBits = this.requiredBits(sumMax - sumMin);
    const sumLowerGapProof = this.proveNonNegative(weightedSumValue - sumMin, weightedSumBlinding, sumBits, `${context}:sum:lo`);
    const sumUpperGapProof = this.proveNonNegative(
      sumMax - weightedSumValue,
      modScalar(SUBGROUP_Q - weightedSumBlinding),
      sumBits,
      `${context}:sum:hi`,
    );

    return {
      coordinates,
      weightedSumCommitment,
      sumMin,
      sumMax,
      sumLowerGapProof,
      sumUpperGapProof,
      context,
    };
  }

  public verifyRangeTuple(proof: RangeTupleProof): boolean {
    if (proof.coordinates.length === 0 || proof.sumMin > proof.sumMax) return false;
    let computedWeightedComm = 1n;

    for (let idx = 0; idx < proof.coordinates.length; idx++) {
      const c = proof.coordinates[idx];
      if (c.min > c.max || c.weight < 0n) return false;

      const expectedLowerComm = (c.commitment * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(c.min)), SAFE_PRIME_P)) % SAFE_PRIME_P;
      if (c.lowerGapProof.targetCommitment !== expectedLowerComm) return false;
      if (!this.verifyNonNegative(c.lowerGapProof, `${proof.context}:c${idx}:lo`)) return false;

      const invComm = modPow(c.commitment, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
      const expectedUpperComm = (modPow(BASE_G, modScalar(c.max), SAFE_PRIME_P) * invComm) % SAFE_PRIME_P;
      if (c.upperGapProof.targetCommitment !== expectedUpperComm) return false;
      if (!this.verifyNonNegative(c.upperGapProof, `${proof.context}:c${idx}:hi`)) return false;

      computedWeightedComm = (computedWeightedComm * modPow(c.commitment, c.weight, SAFE_PRIME_P)) % SAFE_PRIME_P;
    }

    if (computedWeightedComm !== proof.weightedSumCommitment) return false;

    const expectedSumLower = (proof.weightedSumCommitment * modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(proof.sumMin)), SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (proof.sumLowerGapProof.targetCommitment !== expectedSumLower) return false;
    if (!this.verifyNonNegative(proof.sumLowerGapProof, `${proof.context}:sum:lo`)) return false;

    const invSumComm = modPow(proof.weightedSumCommitment, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
    const expectedSumUpper = (modPow(BASE_G, modScalar(proof.sumMax), SAFE_PRIME_P) * invSumComm) % SAFE_PRIME_P;
    if (proof.sumUpperGapProof.targetCommitment !== expectedSumUpper) return false;
    return this.verifyNonNegative(proof.sumUpperGapProof, `${proof.context}:sum:hi`);
  }

  public serializeProof(proof: RangeTupleProof): string {
    return JSON.stringify({
      context: proof.context,
      sumMin: proof.sumMin.toString(),
      sumMax: proof.sumMax.toString(),
      weightedSumCommitment: proof.weightedSumCommitment.toString(16),
      coordinateCount: proof.coordinates.length,
      names: proof.coordinates.map((c) => c.name),
    });
  }
}
