/**
 * @file VerifiableThresholdECDSASignatureSim.ts
 * @description Multi-Epoch Threshold Governance Signer with Weighted Quorum Voting Power,
 * Non-Interactive Feldman Share Verification, Partial Signature Fault Identification,
 * Batch Policy Verification, and Portable JSON Serialization.
 * Assigns weighted voting power (e.g., 1..3 polynomial shares per signer role) and verifies
 * that any subset whose combined weight meets the governance threshold produces a valid
 * constant-size Schnorr governance signature under the single invariant organization public key.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface WeightedMemberSpec {
  memberId: string;
  weight: number; // integer weight >= 1
}

export interface WeightedShareAllocation {
  memberId: string;
  weight: number;
  slotIds: number[];
  secretShares: bigint[];
  publicShares: bigint[];
}

export interface GovernanceEpochSetup {
  epochId: string;
  weightThreshold: number;
  totalWeight: number;
  groupPublicKey: bigint;
  commitments: bigint[];
  allocations: WeightedShareAllocation[];
}

export interface WeightedPartialSig {
  proposalId: string;
  memberId: string;
  slotContributions: Array<{
    slotId: number;
    publicNonceR: bigint;
    partialS: bigint;
    publicShare: bigint;
  }>;
}

export interface GovernanceDecisionSignature {
  epochId: string;
  proposalId: string;
  proposalPayload: string;
  groupPublicKey: bigint;
  combinedR: bigint;
  combinedS: bigint;
  participatingMembers: string[];
  achievedWeight: number;
  decisionDigest: string;
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
 * Weighted-Quorum Threshold Governance Signing & Audit Engine.
 */
export class VerifiableThresholdECDSASignatureSim {
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

  public lagrangeCoefficient(slotId: number, activeSlots: readonly number[]): bigint {
    const xi = BigInt(slotId);
    let num = 1n;
    let den = 1n;
    for (const other of activeSlots) {
      if (other === slotId) continue;
      const xj = BigInt(other);
      num = modNorm(num * xj, this.q);
      den = modNorm(den * modNorm(xj - xi, this.q), this.q);
    }
    return modNorm(num * modInverse(den, this.q), this.q);
  }

  /**
   * Initializes a weighted threshold governance epoch where each member receives `weight`
   * polynomial evaluation slots under a degree-(weightThreshold - 1) Feldman-VSS polynomial.
   */
  public setupWeightedGovernance(
    epochId: string,
    members: readonly WeightedMemberSpec[],
    weightThreshold: number
  ): GovernanceEpochSetup {
    if (members.length === 0) throw new Error('At least one governance member required');
    const seen = new Set<string>();
    let totalWeight = 0;
    for (const m of members) {
      if (!Number.isInteger(m.weight) || m.weight < 1) {
        throw new RangeError(`Invalid weight for ${m.memberId}`);
      }
      if (seen.has(m.memberId)) throw new Error(`Duplicate memberId: ${m.memberId}`);
      seen.add(m.memberId);
      totalWeight += m.weight;
    }
    if (weightThreshold < 1 || weightThreshold > totalWeight) {
      throw new RangeError('weightThreshold must lie in [1, totalWeight]');
    }

    const coeffs: bigint[] = [];
    for (let k = 0; k < weightThreshold; k++) {
      coeffs.push(randomScalar(this.q));
    }
    const commitments = coeffs.map((c) => modPow(this.g, c, this.p));
    const groupPublicKey = commitments[0];

    let nextSlot = 1;
    const allocations: WeightedShareAllocation[] = members.map((m) => {
      const slotIds: number[] = [];
      const secretShares: bigint[] = [];
      const publicShares: bigint[] = [];

      for (let w = 0; w < m.weight; w++) {
        const slotId = nextSlot++;
        const x = BigInt(slotId);
        let s = 0n;
        let xPow = 1n;
        for (const c of coeffs) {
          s = modNorm(s + c * xPow, this.q);
          xPow = modNorm(xPow * x, this.q);
        }
        slotIds.push(slotId);
        secretShares.push(s);
        publicShares.push(modPow(this.g, s, this.p));
      }

      return {
        memberId: m.memberId,
        weight: m.weight,
        slotIds,
        secretShares,
        publicShares,
      };
    });

    return {
      epochId,
      weightThreshold,
      totalWeight,
      groupPublicKey,
      commitments,
      allocations,
    };
  }

  /**
   * Verifies every weighted slot owned by a member against the published Feldman commitments.
   */
  public verifyMemberAllocation(
    allocation: WeightedShareAllocation,
    commitments: readonly bigint[]
  ): boolean {
    if (
      allocation.slotIds.length !== allocation.weight ||
      allocation.secretShares.length !== allocation.weight ||
      allocation.publicShares.length !== allocation.weight
    ) {
      return false;
    }

    for (let idx = 0; idx < allocation.weight; idx++) {
      const slotId = allocation.slotIds[idx];
      const s = allocation.secretShares[idx];
      const pub = allocation.publicShares[idx];
      if (modPow(this.g, modNorm(s, this.q), this.p) !== pub) return false;

      const x = BigInt(slotId);
      let rhs = 1n;
      let xPow = 1n;
      for (const c of commitments) {
        rhs = (rhs * modPow(c, xPow, this.p)) % this.p;
        xPow = modNorm(xPow * x, this.q);
      }
      if (pub !== rhs) return false;
    }
    return true;
  }

  private computeProposalChallenge(
    epochId: string,
    proposalId: string,
    groupPublicKey: bigint,
    combinedR: bigint,
    payload: string
  ): bigint {
    return hashScalar('WorkSphere::WeightedGovE', [
      epochId,
      proposalId,
      groupPublicKey,
      combinedR,
      payload,
    ]);
  }

  /**
   * Executes a weighted quorum signing ceremony for a governance proposal using any subset of
   * members whose combined weight >= weightThreshold.
   */
  public executeWeightedSigning(
    setup: GovernanceEpochSetup,
    proposalId: string,
    proposalPayload: string,
    participatingMemberIds: readonly string[]
  ): {
    decision: GovernanceDecisionSignature;
    partials: WeightedPartialSig[];
    activeSlots: number[];
  } {
    const allocMap = new Map(setup.allocations.map((a) => [a.memberId, a]));
    const selectedAllocs: WeightedShareAllocation[] = [];
    const seen = new Set<string>();
    let weightSum = 0;

    for (const mid of participatingMemberIds) {
      if (seen.has(mid)) throw new Error(`Duplicate participant ${mid}`);
      const alloc = allocMap.get(mid);
      if (!alloc) throw new Error(`Unknown member ${mid}`);
      seen.add(mid);
      selectedAllocs.push(alloc);
      weightSum += alloc.weight;
    }

    if (weightSum < setup.weightThreshold) {
      throw new Error(`Quorum weight not met: ${weightSum} < ${setup.weightThreshold}`);
    }

    // Collect exactly weightThreshold active slots
    const activeEntries: Array<{ memberId: string; slotId: number; secret: bigint; pub: bigint }> = [];
    for (const alloc of selectedAllocs) {
      for (let i = 0; i < alloc.weight && activeEntries.length < setup.weightThreshold; i++) {
        activeEntries.push({
          memberId: alloc.memberId,
          slotId: alloc.slotIds[i],
          secret: alloc.secretShares[i],
          pub: alloc.publicShares[i],
        });
      }
    }

    const activeSlots = activeEntries.map((e) => e.slotId);
    const nonces = activeEntries.map(() => randomScalar(this.q));
    let combinedR = 1n;
    const pubNonces = nonces.map((k) => {
      const r = modPow(this.g, k, this.p);
      combinedR = (combinedR * r) % this.p;
      return r;
    });

    const e = this.computeProposalChallenge(
      setup.epochId,
      proposalId,
      setup.groupPublicKey,
      combinedR,
      proposalPayload
    );

    const byMember = new Map<string, WeightedPartialSig['slotContributions']>();
    let combinedS = 0n;

    for (let i = 0; i < activeEntries.length; i++) {
      const entry = activeEntries[i];
      const lambda = this.lagrangeCoefficient(entry.slotId, activeSlots);
      const partialS = modNorm(nonces[i] + e * modNorm(lambda * entry.secret, this.q), this.q);
      combinedS = modNorm(combinedS + partialS, this.q);

      const list = byMember.get(entry.memberId) ?? [];
      list.push({
        slotId: entry.slotId,
        publicNonceR: pubNonces[i],
        partialS,
        publicShare: entry.pub,
      });
      byMember.set(entry.memberId, list);
    }

    const partials: WeightedPartialSig[] = Array.from(byMember.entries()).map(
      ([memberId, slotContributions]) => ({
        proposalId,
        memberId,
        slotContributions,
      })
    );

    const decisionDigest = createHash('sha256')
      .update(`${setup.epochId}|${proposalId}|${combinedR.toString(16)}|${combinedS.toString(16)}`)
      .digest('hex');

    const decision: GovernanceDecisionSignature = {
      epochId: setup.epochId,
      proposalId,
      proposalPayload,
      groupPublicKey: setup.groupPublicKey,
      combinedR,
      combinedS,
      participatingMembers: Array.from(byMember.keys()),
      achievedWeight: weightSum,
      decisionDigest,
    };

    return { decision, partials, activeSlots };
  }

  /**
   * Audits all member partial slot contributions to pinpoint any faulty signer.
   */
  public auditPartialContributions(
    epochId: string,
    proposalId: string,
    proposalPayload: string,
    groupPublicKey: bigint,
    combinedR: bigint,
    activeSlots: readonly number[],
    partials: readonly WeightedPartialSig[]
  ): { allValid: boolean; faultyMembers: string[] } {
    const e = this.computeProposalChallenge(
      epochId,
      proposalId,
      groupPublicKey,
      combinedR,
      proposalPayload
    );
    const faultyMembers: string[] = [];

    for (const part of partials) {
      let memberOk = true;
      for (const sc of part.slotContributions) {
        const lambda = this.lagrangeCoefficient(sc.slotId, activeSlots);
        const lhs = modPow(this.g, modNorm(sc.partialS, this.q), this.p);
        const rhs = (sc.publicNonceR * modPow(sc.publicShare, modNorm(e * lambda, this.q), this.p)) % this.p;
        if (lhs !== rhs) {
          memberOk = false;
          break;
        }
      }
      if (!memberOk) faultyMembers.push(part.memberId);
    }

    return { allValid: faultyMembers.length === 0, faultyMembers };
  }

  /**
   * Publicly verifies a governance decision signature using ONLY the single groupPublicKey.
   */
  public verifyDecision(decision: GovernanceDecisionSignature): boolean {
    const e = this.computeProposalChallenge(
      decision.epochId,
      decision.proposalId,
      decision.groupPublicKey,
      decision.combinedR,
      decision.proposalPayload
    );
    const lhs = modPow(this.g, modNorm(decision.combinedS, this.q), this.p);
    const rhs = (decision.combinedR * modPow(decision.groupPublicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  public batchVerifyDecisions(decisions: readonly GovernanceDecisionSignature[]): boolean {
    if (decisions.length === 0) return false;
    let sumS = 0n;
    let rhsProd = 1n;
    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i];
      const e = this.computeProposalChallenge(
        d.epochId,
        d.proposalId,
        d.groupPublicKey,
        d.combinedR,
        d.proposalPayload
      );
      const rho = hashScalar('WorkSphere::GovBatchRho', [BigInt(i), d.combinedR, d.combinedS, d.proposalId]);
      sumS = modNorm(sumS + rho * d.combinedS, this.q);
      const term = (d.combinedR * modPow(d.groupPublicKey, e, this.p)) % this.p;
      rhsProd = (rhsProd * modPow(term, rho, this.p)) % this.p;
    }
    return modPow(this.g, sumS, this.p) === rhsProd;
  }

  public serializeDecision(decision: GovernanceDecisionSignature): string {
    return JSON.stringify({
      ...decision,
      groupPublicKey: decision.groupPublicKey.toString(16),
      combinedR: decision.combinedR.toString(16),
      combinedS: decision.combinedS.toString(16),
    });
  }

  public deserializeDecision(payload: string): GovernanceDecisionSignature {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      ...raw,
      groupPublicKey: BigInt(`0x${raw.groupPublicKey}`),
      combinedR: BigInt(`0x${raw.combinedR}`),
      combinedS: BigInt(`0x${raw.combinedS}`),
    } as GovernanceDecisionSignature;
  }
}
