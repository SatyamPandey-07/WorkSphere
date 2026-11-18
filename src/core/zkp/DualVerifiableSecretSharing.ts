import { createHash } from 'crypto';

/**
 * Verifiable Feldman-Pedersen Dual VSS & Gennaro (GJKR) DKG Protocol
 *
 * Implements the Gennaro-Jarecki-Krawczyk-Rabin (GJKR) Distributed Key Generation
 * protocol over a safe-prime subgroup (P = 2Q + 1):
 *   1. Pedersen VSS phase: information-theoretically hiding polynomial commitments
 *      C_{i,k} = g^{a_{i,k}} * h^{b_{i,k}} mod P with dual shares (s_{i,j}, t_{i,j}).
 *   2. Byzantine dispute adjudication & QUAL set assembly (disqualifying bad dealers).
 *   3. Feldman public-key extraction A_{i,k} = g^{a_{i,k}} mod P and verification.
 *   4. Joint threshold public key Y = prod_{i in QUAL} A_{i,0}, per-node threshold
 *      shares x_j = sum_{i in QUAL} s_{i,j}, and verifiable Lagrange reconstruction.
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const GEN_G = 4n; // Order-Q generator g

export interface DualSharePair {
  readonly dealerId: number;
  readonly recipientId: number;
  readonly primaryShare: bigint;
  readonly blindingShare: bigint;
}

export interface DealerDealing {
  readonly dealerId: number;
  readonly pedersenCommitments: readonly bigint[];
  readonly feldmanCommitments: readonly bigint[];
  readonly sharesByRecipient: ReadonlyMap<number, DualSharePair>;
  readonly dealingDigest: string;
}

export interface DealerComplaintVerdict {
  readonly dealerId: number;
  readonly complainantIds: readonly number[];
  readonly qualified: boolean;
  readonly reason?: string;
}

export interface QualifiedDKGOutput {
  readonly threshold: number;
  readonly totalParticipants: number;
  readonly qualifiedDealerIds: readonly number[];
  readonly disqualifiedDealerIds: readonly number[];
  readonly jointPublicKey: bigint;
  readonly combinedShares: ReadonlyMap<number, bigint>;
  readonly verificationPoints: ReadonlyMap<number, bigint>;
  readonly verdicts: readonly DealerComplaintVerdict[];
  readonly transcriptDigest: string;
}

export interface ReconstructionResult {
  readonly isValid: boolean;
  readonly reconstructedValue: bigint;
  readonly matchesJointPublicKey: boolean;
  readonly reason?: string;
}

function modQ(x: bigint): bigint {
  const r = x % SUBGROUP_ORDER;
  return r >= 0n ? r : r + SUBGROUP_ORDER;
}

function modP(x: bigint): bigint {
  const r = x % SAFE_PRIME;
  return r >= 0n ? r : r + SAFE_PRIME;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInverseQ(a: bigint): bigint {
  const val = modQ(a);
  if (val === 0n) throw new Error('Cannot invert zero mod Q');
  return modPow(val, SUBGROUP_ORDER - 2n, SUBGROUP_ORDER);
}

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function evalPolyQ(coeffs: readonly bigint[], x: bigint): bigint {
  let acc = 0n;
  let xPow = 1n;
  for (const c of coeffs) {
    acc = modQ(acc + modQ(modQ(c) * xPow));
    xPow = modQ(xPow * x);
  }
  return acc;
}

function evalCommitmentPoly(commitments: readonly bigint[], participantId: number): bigint {
  const x = BigInt(participantId);
  let acc = 1n;
  let xPow = 1n;
  for (const c of commitments) {
    acc = modP(acc * modPow(c, xPow, SAFE_PRIME));
    xPow = modQ(xPow * x);
  }
  return acc;
}

export class DualVerifiableSecretSharing {
  private readonly threshold: number;
  private readonly totalParticipants: number;
  private readonly genH: bigint;

  constructor(
    threshold: number,
    totalParticipants: number,
    domainSeed = 'WORKSPHERE_GJKR_DUAL_VSS_V1'
  ) {
    if (!Number.isInteger(threshold) || !Number.isInteger(totalParticipants)) {
      throw new Error('threshold and totalParticipants must be integers');
    }
    if (threshold < 2 || threshold > totalParticipants) {
      throw new Error('Require 2 <= threshold <= totalParticipants');
    }
    this.threshold = threshold;
    this.totalParticipants = totalParticipants;
    this.genH = modPow(GEN_G, hashToScalar('GJKR_GEN_H', [domainSeed]), SAFE_PRIME);
  }

  public getThreshold(): number {
    return this.threshold;
  }

  public createDealerDealing(dealerId: number, epochSeed: string): DealerDealing {
    if (!Number.isInteger(dealerId) || dealerId < 1 || dealerId > this.totalParticipants) {
      throw new Error(`Invalid dealerId: ${dealerId}`);
    }

    const aCoeffs: bigint[] = [];
    const bCoeffs: bigint[] = [];
    for (let k = 0; k < this.threshold; k++) {
      aCoeffs.push(hashToScalar('GJKR_POLY_A', [epochSeed, String(dealerId), String(k)]));
      bCoeffs.push(hashToScalar('GJKR_POLY_B', [epochSeed, String(dealerId), String(k)]));
    }

    const pedersenCommitments = aCoeffs.map((a, k) =>
      modP(modPow(GEN_G, a, SAFE_PRIME) * modPow(this.genH, bCoeffs[k], SAFE_PRIME))
    );
    const feldmanCommitments = aCoeffs.map((a) => modPow(GEN_G, a, SAFE_PRIME));

    const sharesByRecipient = new Map<number, DualSharePair>();
    for (let j = 1; j <= this.totalParticipants; j++) {
      const x = BigInt(j);
      sharesByRecipient.set(j, {
        dealerId,
        recipientId: j,
        primaryShare: evalPolyQ(aCoeffs, x),
        blindingShare: evalPolyQ(bCoeffs, x),
      });
    }

    const dealingDigest = createHash('sha256')
      .update(`GJKR_DEALING|${dealerId}|`)
      .update(pedersenCommitments.map((c) => c.toString(16)).join(','))
      .update('|')
      .update(feldmanCommitments.map((c) => c.toString(16)).join(','))
      .digest('hex');

    return {
      dealerId,
      pedersenCommitments,
      feldmanCommitments,
      sharesByRecipient,
      dealingDigest,
    };
  }

  public verifyPedersenShare(share: DualSharePair, pedersenCommitments: readonly bigint[]): boolean {
    if (pedersenCommitments.length !== this.threshold) return false;
    const lhs = modP(
      modPow(GEN_G, modQ(share.primaryShare), SAFE_PRIME) *
        modPow(this.genH, modQ(share.blindingShare), SAFE_PRIME)
    );
    const rhs = evalCommitmentPoly(pedersenCommitments, share.recipientId);
    return lhs === rhs;
  }

  public verifyFeldmanShare(share: DualSharePair, feldmanCommitments: readonly bigint[]): boolean {
    if (feldmanCommitments.length !== this.threshold) return false;
    const lhs = modPow(GEN_G, modQ(share.primaryShare), SAFE_PRIME);
    const rhs = evalCommitmentPoly(feldmanCommitments, share.recipientId);
    return lhs === rhs;
  }

  public runDKG(dealings: readonly DealerDealing[]): QualifiedDKGOutput {
    if (dealings.length === 0) {
      throw new Error('At least one dealer dealing is required');
    }

    const qualifiedDealings: DealerDealing[] = [];
    const qualifiedDealerIds: number[] = [];
    const disqualifiedDealerIds: number[] = [];
    const verdicts: DealerComplaintVerdict[] = [];

    for (const dealing of dealings) {
      const complainants: number[] = [];
      let reason: string | undefined;

      if (
        dealing.pedersenCommitments.length !== this.threshold ||
        dealing.feldmanCommitments.length !== this.threshold
      ) {
        disqualifiedDealerIds.push(dealing.dealerId);
        verdicts.push({
          dealerId: dealing.dealerId,
          complainantIds: [],
          qualified: false,
          reason: 'Commitment polynomial degree does not match threshold',
        });
        continue;
      }

      for (let j = 1; j <= this.totalParticipants; j++) {
        const share = dealing.sharesByRecipient.get(j);
        if (
          !share ||
          !this.verifyPedersenShare(share, dealing.pedersenCommitments) ||
          !this.verifyFeldmanShare(share, dealing.feldmanCommitments)
        ) {
          complainants.push(j);
          reason = 'Failed Pedersen or Feldman share verification';
        }
      }

      if (complainants.length === 0) {
        qualifiedDealings.push(dealing);
        qualifiedDealerIds.push(dealing.dealerId);
        verdicts.push({
          dealerId: dealing.dealerId,
          complainantIds: [],
          qualified: true,
        });
      } else {
        disqualifiedDealerIds.push(dealing.dealerId);
        verdicts.push({
          dealerId: dealing.dealerId,
          complainantIds: complainants,
          qualified: false,
          reason,
        });
      }
    }

    if (qualifiedDealings.length === 0) {
      throw new Error('No honest dealers qualified during DKG');
    }

    let jointPublicKey = 1n;
    for (const qd of qualifiedDealings) {
      jointPublicKey = modP(jointPublicKey * qd.feldmanCommitments[0]);
    }

    const combinedShares = new Map<number, bigint>();
    const verificationPoints = new Map<number, bigint>();

    for (let j = 1; j <= this.totalParticipants; j++) {
      let xj = 0n;
      let yj = 1n;
      for (const qd of qualifiedDealings) {
        const pair = qd.sharesByRecipient.get(j)!;
        xj = modQ(xj + pair.primaryShare);
        yj = modP(yj * evalCommitmentPoly(qd.feldmanCommitments, j));
      }
      if (modPow(GEN_G, xj, SAFE_PRIME) !== yj) {
        throw new Error(`Combined share verification invariant failed for participant ${j}`);
      }
      combinedShares.set(j, xj);
      verificationPoints.set(j, yj);
    }

    const transcriptDigest = createHash('sha256')
      .update('GJKR_DKG_OUTPUT|')
      .update(`${this.threshold}|${this.totalParticipants}|`)
      .update(`${qualifiedDealerIds.join(',')}|${disqualifiedDealerIds.join(',')}|`)
      .update(jointPublicKey.toString(16))
      .digest('hex');

    return {
      threshold: this.threshold,
      totalParticipants: this.totalParticipants,
      qualifiedDealerIds,
      disqualifiedDealerIds,
      jointPublicKey,
      combinedShares,
      verificationPoints,
      verdicts,
      transcriptDigest,
    };
  }

  public reconstructJointValue(
    subsetShares: ReadonlyArray<{ readonly participantId: number; readonly shareValue: bigint }>,
    dkgOutput: QualifiedDKGOutput
  ): ReconstructionResult {
    if (subsetShares.length < this.threshold) {
      return {
        isValid: false,
        reconstructedValue: 0n,
        matchesJointPublicKey: false,
        reason: `Need at least ${this.threshold} shares for reconstruction`,
      };
    }

    const selected = subsetShares.slice(0, this.threshold);
    const ids = selected.map((s) => s.participantId);
    if (new Set(ids).size !== ids.length) {
      return {
        isValid: false,
        reconstructedValue: 0n,
        matchesJointPublicKey: false,
        reason: 'Duplicate participant IDs in reconstruction subset',
      };
    }

    for (const s of selected) {
      const expectedPoint = dkgOutput.verificationPoints.get(s.participantId);
      if (!expectedPoint || modPow(GEN_G, modQ(s.shareValue), SAFE_PRIME) !== expectedPoint) {
        return {
          isValid: false,
          reconstructedValue: 0n,
          matchesJointPublicKey: false,
          reason: `Invalid share submitted by participant ${s.participantId}`,
        };
      }
    }

    let reconstructed = 0n;
    for (const s of selected) {
      let num = 1n;
      let den = 1n;
      const xI = BigInt(s.participantId);
      for (const otherId of ids) {
        if (otherId === s.participantId) continue;
        const xJ = BigInt(otherId);
        num = modQ(num * modQ(-xJ));
        den = modQ(den * modQ(xI - xJ));
      }
      const lambda = modQ(num * modInverseQ(den));
      reconstructed = modQ(reconstructed + modQ(modQ(s.shareValue) * lambda));
    }

    const matchesJointPublicKey =
      modPow(GEN_G, reconstructed, SAFE_PRIME) === dkgOutput.jointPublicKey;

    return {
      isValid: matchesJointPublicKey,
      reconstructedValue: reconstructed,
      matchesJointPublicKey,
      reason: matchesJointPublicKey ? undefined : 'Reconstructed value does not match joint public key',
    };
  }
}
