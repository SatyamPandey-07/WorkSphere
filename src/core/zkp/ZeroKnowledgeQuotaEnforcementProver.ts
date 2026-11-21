import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Cumulative Usage Quota Enforcement Prover.
 *
 * Allows a privacy-preserving service or API gateway to enforce strict cumulative quotas
 * (e.g., max tokens, max spend, max bandwidth per epoch) without learning individual usage
 * event sizes:
 *  - Each usage event e_i produces a Pedersen commitment C_i = g^{u_i} * h^{r_i} mod P
 *    along with a non-negativity proof that u_i >= 0 (preventing negative credit injection!)
 *  - Homomorphic cumulative commitment: C_total = prod C_i = g^{sum u_i} * h^{sum r_i}
 *  - Headroom commitment: C_headroom = g^{quotaLimit} * C_total^{-1} = g^{quotaLimit - sum u_i} * h^{-sum r_i}
 *  - Prover emits a bit-decomposition OR-proof certifying headroom >= 0 (so sum u_i <= quotaLimit)
 *    while hiding the exact total usage and every individual event amount!
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
  const raw = (BigInt('0x' + sha256Hex('ZK-QUOTA-ENFORCE-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();
const INV_G = modPow(BASE_G, SAFE_PRIME_P - 2n, SAFE_PRIME_P);

export interface QuotaBitORProof {
  bitCommitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  s0: bigint;
  s1: bigint;
}

export interface UnsignedRangeProof {
  commitment: bigint;
  bitLength: number;
  bits: QuotaBitORProof[];
}

export interface UsageEventRecord {
  eventId: string;
  amount: bigint;
  blinding: bigint;
  commitment: bigint;
  nonNegativeProof: UnsignedRangeProof;
}

export interface QuotaComplianceCertificate {
  accountId: string;
  epochId: string;
  quotaLimit: bigint;
  eventIds: string[];
  eventCommitments: bigint[];
  eventRangeProofs: UnsignedRangeProof[];
  cumulativeCommitment: bigint;
  headroomCommitment: bigint;
  headroomProof: UnsignedRangeProof;
}

export class ZeroKnowledgeQuotaEnforcementProver {
  private proveBit(bit: 0 | 1, blinding: bigint, tag: string): QuotaBitORProof {
    const bitCommitment = (modPow(BASE_G, BigInt(bit), SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const cDivG = (bitCommitment * INV_G) % SAFE_PRIME_P;

    if (bit === 0) {
      const k0 = randomScalar();
      const a0 = modPow(BASE_H, k0, SAFE_PRIME_P);
      const c1 = randomScalar();
      const s1 = randomScalar();
      const a1 = (modPow(BASE_H, s1, SAFE_PRIME_P) * modPow(cDivG, modScalar(SUBGROUP_Q - c1), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const e = hashToScalar('QUOTA-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c0 = modScalar(e - c1);
      const s0 = modScalar(k0 + c0 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    } else {
      const c0 = randomScalar();
      const s0 = randomScalar();
      const a0 = (modPow(BASE_H, s0, SAFE_PRIME_P) * modPow(bitCommitment, modScalar(SUBGROUP_Q - c0), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const k1 = randomScalar();
      const a1 = modPow(BASE_H, k1, SAFE_PRIME_P);
      const e = hashToScalar('QUOTA-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c1 = modScalar(e - c0);
      const s1 = modScalar(k1 + c1 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    }
  }

  private verifyBit(bp: QuotaBitORProof, tag: string): boolean {
    const e = hashToScalar('QUOTA-BIT-V1', bp.bitCommitment.toString(16), bp.a0.toString(16), bp.a1.toString(16), tag);
    if (modScalar(bp.c0 + bp.c1) !== e) return false;
    const ok0 = modPow(BASE_H, bp.s0, SAFE_PRIME_P) === (bp.a0 * modPow(bp.bitCommitment, bp.c0, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (!ok0) return false;
    const cDivG = (bp.bitCommitment * INV_G) % SAFE_PRIME_P;
    return modPow(BASE_H, bp.s1, SAFE_PRIME_P) === (bp.a1 * modPow(cDivG, bp.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public proveUnsignedRange(value: bigint, blinding: bigint, bitLength: number, tag: string): UnsignedRangeProof {
    if (value < 0n || value >= (1n << BigInt(bitLength))) {
      throw new RangeError(`Value ${value} out of [${0}, 2^${bitLength})`);
    }
    const commitment = (modPow(BASE_G, value, SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const bitBlindings: bigint[] = [];
    let acc = 0n;
    for (let i = 0; i < bitLength; i++) {
      if (i < bitLength - 1) {
        const ri = randomScalar();
        bitBlindings.push(ri);
        acc = modScalar(acc + (1n << BigInt(i)) * ri);
      } else {
        const invPow2 = modPow((1n << BigInt(i)) % SUBGROUP_Q, SUBGROUP_Q - 2n, SUBGROUP_Q);
        bitBlindings.push(modScalar((blinding - acc) * invPow2));
      }
    }
    const bits: QuotaBitORProof[] = [];
    for (let i = 0; i < bitLength; i++) {
      const bit = Number((value >> BigInt(i)) & 1n) as 0 | 1;
      bits.push(this.proveBit(bit, bitBlindings[i], `${tag}:b${i}`));
    }
    return { commitment, bitLength, bits };
  }

  public verifyUnsignedRange(proof: UnsignedRangeProof, tag: string): boolean {
    if (proof.bitLength < 1 || proof.bits.length !== proof.bitLength) return false;
    let reconstructed = 1n;
    for (let i = 0; i < proof.bitLength; i++) {
      if (!this.verifyBit(proof.bits[i], `${tag}:b${i}`)) return false;
      reconstructed = (reconstructed * modPow(proof.bits[i].bitCommitment, 1n << BigInt(i), SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return reconstructed === proof.commitment;
  }

  public recordUsageEvent(
    accountId: string,
    epochId: string,
    eventId: string,
    amount: bigint,
    eventBitLength = 16,
  ): UsageEventRecord {
    const blinding = randomScalar();
    const nonNegativeProof = this.proveUnsignedRange(amount, blinding, eventBitLength, `${accountId}:${epochId}:ev:${eventId}`);
    return {
      eventId,
      amount,
      blinding,
      commitment: nonNegativeProof.commitment,
      nonNegativeProof,
    };
  }

  public generateQuotaComplianceCertificate(
    accountId: string,
    epochId: string,
    quotaLimit: bigint,
    events: UsageEventRecord[],
    quotaBitLength = 20,
  ): QuotaComplianceCertificate {
    if (quotaLimit < 0n || quotaLimit >= (1n << BigInt(quotaBitLength))) {
      throw new RangeError('quotaLimit outside configured quotaBitLength');
    }
    const seenIds = new Set<string>();
    let totalUsage = 0n;
    let totalBlinding = 0n;
    let cumulativeCommitment = 1n;

    for (const ev of events) {
      if (seenIds.has(ev.eventId)) throw new Error(`Duplicate usage eventId "${ev.eventId}"`);
      seenIds.add(ev.eventId);
      totalUsage += ev.amount;
      totalBlinding = modScalar(totalBlinding + ev.blinding);
      cumulativeCommitment = (cumulativeCommitment * ev.commitment) % SAFE_PRIME_P;
    }

    if (totalUsage > quotaLimit) {
      throw new Error(`Quota exceeded: cumulative usage ${totalUsage} > limit ${quotaLimit}`);
    }

    const headroom = quotaLimit - totalUsage;
    const headroomBlinding = modScalar(SUBGROUP_Q - totalBlinding);
    const headroomProof = this.proveUnsignedRange(
      headroom,
      headroomBlinding,
      quotaBitLength,
      `${accountId}:${epochId}:headroom:${quotaLimit.toString()}`,
    );

    return {
      accountId,
      epochId,
      quotaLimit,
      eventIds: events.map((e) => e.eventId),
      eventCommitments: events.map((e) => e.commitment),
      eventRangeProofs: events.map((e) => e.nonNegativeProof),
      cumulativeCommitment,
      headroomCommitment: headroomProof.commitment,
      headroomProof,
    };
  }

  public verifyQuotaCompliance(cert: QuotaComplianceCertificate): boolean {
    if (
      cert.eventIds.length !== cert.eventCommitments.length ||
      cert.eventIds.length !== cert.eventRangeProofs.length
    ) {
      return false;
    }

    const seen = new Set<string>();
    let computedCumulative = 1n;
    for (let i = 0; i < cert.eventIds.length; i++) {
      const id = cert.eventIds[i];
      if (seen.has(id)) return false;
      seen.add(id);
      const rp = cert.eventRangeProofs[i];
      if (rp.commitment !== cert.eventCommitments[i]) return false;
      if (!this.verifyUnsignedRange(rp, `${cert.accountId}:${cert.epochId}:ev:${id}`)) return false;
      computedCumulative = (computedCumulative * cert.eventCommitments[i]) % SAFE_PRIME_P;
    }

    if (computedCumulative !== cert.cumulativeCommitment) return false;

    const invCum = modPow(cert.cumulativeCommitment, SAFE_PRIME_P - 2n, SAFE_PRIME_P);
    const expectedHeadroom = (modPow(BASE_G, modScalar(cert.quotaLimit), SAFE_PRIME_P) * invCum) % SAFE_PRIME_P;
    if (expectedHeadroom !== cert.headroomCommitment || cert.headroomProof.commitment !== expectedHeadroom) {
      return false;
    }

    return this.verifyUnsignedRange(
      cert.headroomProof,
      `${cert.accountId}:${cert.epochId}:headroom:${cert.quotaLimit.toString()}`,
    );
  }

  public serializeCertificate(cert: QuotaComplianceCertificate): string {
    return JSON.stringify({
      accountId: cert.accountId,
      epochId: cert.epochId,
      quotaLimit: cert.quotaLimit.toString(),
      eventCount: cert.eventIds.length,
    });
  }
}
