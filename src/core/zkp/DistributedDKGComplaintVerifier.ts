/**
 * @file DistributedDKGComplaintVerifier.ts
 * @description Trustless Joint-Feldman / Pedersen Distributed Key Generation (DKG) protocol
 * with polynomial commitment broadcasting, per-share verification, verifiable complaint
 * adjudication, cheater disqualification, qualified-set group public key aggregation,
 * Lagrange key reconstruction checks, and portable transcript serialization.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface DKGParticipantDeal {
  dealerId: number;
  commitments: bigint[];
  proofOfPossession: {
    nonceCommit: bigint;
    challenge: bigint;
    response: bigint;
  };
  shares: Map<number, bigint>;
}

export interface DKGComplaint {
  complainantId: number;
  accusedDealerId: number;
  receivedShare: bigint;
  reason: string;
}

export interface DKGComplaintResolution {
  complaint: DKGComplaint;
  complaintUpheld: boolean;
  dealerDisqualified: boolean;
  resolvedShare?: bigint;
  verdictHash: string;
}

export interface DKGFinalParticipantKey {
  participantId: number;
  combinedSecretShare: bigint;
  publicKeyShare: bigint;
  qualifiedDealers: number[];
}

export interface DKGSessionSummary {
  sessionId: string;
  threshold: number;
  participantIds: number[];
  qualifiedDealers: number[];
  disqualifiedDealers: number[];
  groupPublicKey: bigint;
  participantKeys: DKGFinalParticipantKey[];
  resolutions: DKGComplaintResolution[];
  transcriptDigest: string;
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
 * Joint-Feldman DKG coordinator with proof-of-possession (defending against rogue-key attacks)
 * and objective complaint adjudication.
 */
export class DistributedDKGComplaintVerifier {
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

  /**
   * Generates a dealer's degree-(t-1) polynomial, Feldman commitments, Schnorr PoP for a_0,
   * and evaluated shares f_i(j) for every participant j.
   */
  public generateDealerContribution(
    sessionId: string,
    dealerId: number,
    threshold: number,
    participantIds: readonly number[]
  ): DKGParticipantDeal {
    if (threshold < 1 || threshold > participantIds.length) {
      throw new RangeError('Invalid threshold for DKG participant set');
    }

    const coeffs: bigint[] = [];
    for (let k = 0; k < threshold; k++) {
      coeffs.push(randomScalar(this.q));
    }
    const commitments = coeffs.map((c) => modPow(this.g, c, this.p));

    // Schnorr Proof-of-Possession of constant term coeffs[0]
    const nonce = randomScalar(this.q);
    const nonceCommit = modPow(this.g, nonce, this.p);
    const challenge = hashScalar('WorkSphere::DKGPoP', [
      sessionId,
      BigInt(dealerId),
      commitments[0],
      nonceCommit,
    ]);
    const response = modNorm(nonce + challenge * coeffs[0], this.q);

    const shares = new Map<number, bigint>();
    for (const pid of participantIds) {
      const x = BigInt(pid);
      let y = 0n;
      let xPow = 1n;
      for (const c of coeffs) {
        y = modNorm(y + c * xPow, this.q);
        xPow = modNorm(xPow * x, this.q);
      }
      shares.set(pid, y);
    }

    return {
      dealerId,
      commitments,
      proofOfPossession: { nonceCommit, challenge, response },
      shares,
    };
  }

  /**
   * Verifies a dealer's Schnorr proof-of-possession on their constant commitment C_{i,0}.
   */
  public verifyDealerProofOfPossession(sessionId: string, deal: DKGParticipantDeal): boolean {
    if (deal.commitments.length === 0) return false;
    const pop = deal.proofOfPossession;
    const expectedC = hashScalar('WorkSphere::DKGPoP', [
      sessionId,
      BigInt(deal.dealerId),
      deal.commitments[0],
      pop.nonceCommit,
    ]);
    if (expectedC !== pop.challenge) return false;

    const lhs = modPow(this.g, pop.response, this.p);
    const rhs = (pop.nonceCommit * modPow(deal.commitments[0], pop.challenge, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Verifies an individual Feldman share s_{i -> j} against dealer i's commitment vector:
   *   g^{s_{i -> j}} == Prod_{k=0}^{t-1} C_{i,k}^{j^k} mod p
   */
  public verifyShareAgainstCommitments(
    recipientId: number,
    share: bigint,
    commitments: readonly bigint[]
  ): boolean {
    const lhs = modPow(this.g, modNorm(share, this.q), this.p);
    const x = BigInt(recipientId);
    let rhs = 1n;
    let xPow = 1n;
    for (const comm of commitments) {
      rhs = (rhs * modPow(comm, xPow, this.p)) % this.p;
      xPow = modNorm(xPow * x, this.q);
    }
    return lhs === rhs;
  }

  /**
   * Evaluates a participant's complaint against an accused dealer. If the dealer supplies
   * a valid broadcast defense share, the complaint is dismissed; otherwise the dealer is disqualified.
   */
  public adjudicateComplaint(
    complaint: DKGComplaint,
    accusedDeal: DKGParticipantDeal,
    dealerDefenseShare?: bigint
  ): DKGComplaintResolution {
    const receivedValid = this.verifyShareAgainstCommitments(
      complaint.complainantId,
      complaint.receivedShare,
      accusedDeal.commitments
    );

    let complaintUpheld = !receivedValid;
    let dealerDisqualified = false;
    let resolvedShare: bigint | undefined;

    if (receivedValid) {
      // False complaint: share was actually valid
      complaintUpheld = false;
      dealerDisqualified = false;
      resolvedShare = complaint.receivedShare;
    } else if (
      dealerDefenseShare !== undefined &&
      this.verifyShareAgainstCommitments(
        complaint.complainantId,
        dealerDefenseShare,
        accusedDeal.commitments
      )
    ) {
      // Dealer cured the bad share publicly
      complaintUpheld = true;
      dealerDisqualified = false;
      resolvedShare = dealerDefenseShare;
    } else {
      // Dealer failed to produce a valid share -> permanently disqualified
      complaintUpheld = true;
      dealerDisqualified = true;
    }

    const verdictHash = createHash('sha256')
      .update(
        `WorkSphere::DKGVerdict|${complaint.complainantId}|${complaint.accusedDealerId}|${complaintUpheld}|${dealerDisqualified}`
      )
      .digest('hex');

    return {
      complaint,
      complaintUpheld,
      dealerDisqualified,
      resolvedShare,
      verdictHash,
    };
  }

  /**
   * Runs the complete DKG finalization phase: validates every dealer's PoP, inspects all
   * received shares, adjudicates complaints (with optional dealer cures), computes the qualified
   * dealer set QUAL, derives the group public key, and outputs each participant's final share.
   */
  public finalizeDKGSession(
    sessionId: string,
    threshold: number,
    participantIds: readonly number[],
    deals: readonly DKGParticipantDeal[],
    defenseShares?: ReadonlyMap<string, bigint>
  ): DKGSessionSummary {
    const qualifiedDealers: number[] = [];
    const disqualifiedSet = new Set<number>();
    const resolutions: DKGComplaintResolution[] = [];
    const dealMap = new Map<number, DKGParticipantDeal>();

    for (const deal of deals) {
      dealMap.set(deal.dealerId, deal);
      if (deal.commitments.length !== threshold || !this.verifyDealerProofOfPossession(sessionId, deal)) {
        disqualifiedSet.add(deal.dealerId);
        continue;
      }

      let dealerFailed = false;
      for (const pid of participantIds) {
        const share = deal.shares.get(pid);
        if (share === undefined || !this.verifyShareAgainstCommitments(pid, share, deal.commitments)) {
          const complaint: DKGComplaint = {
            complainantId: pid,
            accusedDealerId: deal.dealerId,
            receivedShare: share ?? 0n,
            reason: share === undefined ? 'Missing share' : 'Feldman commitment check failed',
          };
          const defense = defenseShares?.get(`${deal.dealerId}:${pid}`);
          const resolution = this.adjudicateComplaint(complaint, deal, defense);
          resolutions.push(resolution);
          if (resolution.dealerDisqualified) {
            dealerFailed = true;
            break;
          } else if (resolution.resolvedShare !== undefined) {
            deal.shares.set(pid, resolution.resolvedShare);
          }
        }
      }

      if (dealerFailed) {
        disqualifiedSet.add(deal.dealerId);
      } else {
        qualifiedDealers.push(deal.dealerId);
      }
    }

    if (qualifiedDealers.length < threshold) {
      throw new Error(
        `Insufficient qualified dealers (${qualifiedDealers.length}) for threshold ${threshold}`
      );
    }

    let groupPublicKey = 1n;
    for (const did of qualifiedDealers) {
      const d = dealMap.get(did)!;
      groupPublicKey = (groupPublicKey * d.commitments[0]) % this.p;
    }

    const participantKeys: DKGFinalParticipantKey[] = [];
    for (const pid of participantIds) {
      let combinedSecretShare = 0n;
      for (const did of qualifiedDealers) {
        const d = dealMap.get(did)!;
        combinedSecretShare = modNorm(combinedSecretShare + (d.shares.get(pid) ?? 0n), this.q);
      }
      const publicKeyShare = modPow(this.g, combinedSecretShare, this.p);
      participantKeys.push({
        participantId: pid,
        combinedSecretShare,
        publicKeyShare,
        qualifiedDealers: [...qualifiedDealers],
      });
    }

    const disqualifiedDealers = Array.from(disqualifiedSet).sort((a, b) => a - b);
    const transcriptDigest = createHash('sha256')
      .update(
        `${sessionId}|t:${threshold}|qual:${qualifiedDealers.join(',')}|disq:${disqualifiedDealers.join(',')}|gpk:${groupPublicKey.toString(16)}`
      )
      .digest('hex');

    return {
      sessionId,
      threshold,
      participantIds: [...participantIds],
      qualifiedDealers,
      disqualifiedDealers,
      groupPublicKey,
      participantKeys,
      resolutions,
      transcriptDigest,
    };
  }

  /**
   * Computes Lagrange interpolation coefficient lambda_i(0) for a subset of participant IDs.
   */
  public lagrangeCoefficient(participantId: number, subsetIds: readonly number[]): bigint {
    const xi = BigInt(participantId);
    let num = 1n;
    let den = 1n;
    for (const other of subsetIds) {
      if (other === participantId) continue;
      const xj = BigInt(other);
      num = modNorm(num * xj, this.q);
      den = modNorm(den * modNorm(xj - xi, this.q), this.q);
    }
    return modNorm(num * modInverse(den, this.q), this.q);
  }

  /**
   * Verifies that any t-subset of final participant public key shares interpolates in the
   * exponent to the exact derived groupPublicKey: Prod Y_i^{lambda_i} == groupPublicKey mod p.
   */
  public verifyPublicKeyConsistency(
    summary: DKGSessionSummary,
    subsetParticipantIds: readonly number[]
  ): boolean {
    if (subsetParticipantIds.length < summary.threshold) return false;
    const keyMap = new Map(summary.participantKeys.map((k) => [k.participantId, k]));

    let reconstructedPub = 1n;
    for (const pid of subsetParticipantIds) {
      const pk = keyMap.get(pid);
      if (!pk) return false;
      const lambda = this.lagrangeCoefficient(pid, subsetParticipantIds);
      reconstructedPub = (reconstructedPub * modPow(pk.publicKeyShare, lambda, this.p)) % this.p;
    }

    return reconstructedPub === summary.groupPublicKey;
  }

  /**
   * Serializes public DKG session metadata (excluding private shares) for consensus logging.
   */
  public serializePublicTranscript(summary: DKGSessionSummary): string {
    return JSON.stringify({
      sessionId: summary.sessionId,
      threshold: summary.threshold,
      participantIds: summary.participantIds,
      qualifiedDealers: summary.qualifiedDealers,
      disqualifiedDealers: summary.disqualifiedDealers,
      groupPublicKey: summary.groupPublicKey.toString(16),
      publicKeyShares: summary.participantKeys.map((k) => ({
        participantId: k.participantId,
        publicKeyShare: k.publicKeyShare.toString(16),
      })),
      transcriptDigest: summary.transcriptDigest,
    });
  }
}
