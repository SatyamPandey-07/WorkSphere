/**
 * @file ZeroKnowledgePedersenThresholdAudit.ts
 * @description Threshold Pedersen Distributed Audit Quorum with Verifiable Partial Openings,
 * Lagrange Blinding Reconstruction, Zero-Knowledge Compliance Attestations, Faulty Auditor
 * Isolation, and Portable JSON Serialization.
 * Allows an organization to commit to sensitive telemetry (e.g. compliance balance or audit count)
 * under a Pedersen commitment C = g^v * h^r where the blinding scalar r is (t, n)-shared among
 * independent auditors — no subset < t can open C, while any t honest auditors can jointly open
 * or prove C == g^v * h^r without ever exposing the master blinding secret!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface AuditorBlindingShare {
  auditorId: number;
  blindingShare: bigint;
  publicCommitH: bigint; // h^{r_i} mod p
}

export interface ThresholdPedersenCommitment {
  auditId: string;
  threshold: number;
  auditorIds: number[];
  valueCommitment: bigint; // C = g^v * h^r mod p
  blindingPolynomialCommits: bigint[]; // h^{c_k} mod p
  shares: AuditorBlindingShare[];
  commitDigest: string;
}

export interface PartialOpeningShare {
  auditId: string;
  auditorId: number;
  partialBlindingCommit: bigint; // h^{r_i}
  dleqNonce: bigint;
  challenge: bigint;
  response: bigint;
}

export interface JointAuditOpeningProof {
  auditId: string;
  claimedValue: bigint;
  valueCommitment: bigint;
  participatingAuditors: number[];
  partialShares: PartialOpeningShare[];
  reconstructedBlindingCommit: bigint;
  openingDigest: string;
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
  const digest = createHash('sha256').update(`WorkSphere::ThreshPedAuditH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
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
 * Threshold Pedersen Distributed Audit Quorum Engine.
 */
export class ZeroKnowledgePedersenThresholdAudit {
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

  public lagrangeCoefficient(id: number, subsetIds: readonly number[]): bigint {
    const xi = BigInt(id);
    let num = 1n;
    let den = 1n;
    for (const other of subsetIds) {
      if (other === id) continue;
      const xj = BigInt(other);
      num = modNorm(num * xj, this.q);
      den = modNorm(den * modNorm(xj - xi, this.q), this.q);
    }
    return modNorm(num * modInverse(den, this.q), this.q);
  }

  /**
   * Commits to `secretValue` with a master blinding scalar r distributed via (t, n) Feldman-VSS
   * over base H across `auditorIds`.
   */
  public createThresholdCommitment(
    auditId: string,
    secretValue: bigint,
    threshold: number,
    auditorIds: readonly number[]
  ): ThresholdPedersenCommitment {
    if (threshold < 1 || threshold > auditorIds.length) {
      throw new RangeError('Threshold must satisfy 1 <= threshold <= auditorIds.length');
    }

    const rCoeffs: bigint[] = [];
    for (let k = 0; k < threshold; k++) rCoeffs.push(randomScalar(this.q));
    const blindingPolynomialCommits = rCoeffs.map((c) => modPow(this.h, c, this.p));
    const valueCommitment =
      (modPow(this.g, modNorm(secretValue, this.q), this.p) * blindingPolynomialCommits[0]) % this.p;

    const shares: AuditorBlindingShare[] = auditorIds.map((auditorId) => {
      const x = BigInt(auditorId);
      let rShare = 0n;
      let xPow = 1n;
      for (const c of rCoeffs) {
        rShare = modNorm(rShare + c * xPow, this.q);
        xPow = modNorm(xPow * x, this.q);
      }
      return {
        auditorId,
        blindingShare: rShare,
        publicCommitH: modPow(this.h, rShare, this.p),
      };
    });

    const commitDigest = createHash('sha256')
      .update(`${auditId}|t:${threshold}|C:${valueCommitment.toString(16)}`)
      .digest('hex');

    return {
      auditId,
      threshold,
      auditorIds: [...auditorIds],
      valueCommitment,
      blindingPolynomialCommits,
      shares,
      commitDigest,
    };
  }

  public verifyAuditorShare(
    share: AuditorBlindingShare,
    blindingCommits: readonly bigint[]
  ): boolean {
    const lhs = modPow(this.h, modNorm(share.blindingShare, this.q), this.p);
    const x = BigInt(share.auditorId);
    let rhs = 1n;
    let xPow = 1n;
    for (const c of blindingCommits) {
      rhs = (rhs * modPow(c, xPow, this.p)) % this.p;
      xPow = modNorm(xPow * x, this.q);
    }
    return lhs === rhs && share.publicCommitH === rhs;
  }

  /**
   * An auditor emits a verifiable Schnorr proof of knowledge of their blinding share r_i for `auditId`.
   */
  public producePartialOpening(
    auditId: string,
    share: AuditorBlindingShare
  ): PartialOpeningShare {
    const k = randomScalar(this.q);
    const dleqNonce = modPow(this.h, k, this.p);
    const challenge = hashScalar('WorkSphere::ThreshPedPartOpen', [
      auditId,
      BigInt(share.auditorId),
      share.publicCommitH,
      dleqNonce,
    ]);
    const response = modNorm(k + challenge * share.blindingShare, this.q);

    return {
      auditId,
      auditorId: share.auditorId,
      partialBlindingCommit: share.publicCommitH,
      dleqNonce,
      challenge,
      response,
    };
  }

  public verifyPartialOpening(
    partial: PartialOpeningShare,
    blindingCommits: readonly bigint[]
  ): boolean {
    // Expected h^{r_i} from polynomial commitments
    const x = BigInt(partial.auditorId);
    let expectedH = 1n;
    let xPow = 1n;
    for (const c of blindingCommits) {
      expectedH = (expectedH * modPow(c, xPow, this.p)) % this.p;
      xPow = modNorm(xPow * x, this.q);
    }
    if (expectedH !== partial.partialBlindingCommit) return false;

    const expectedC = hashScalar('WorkSphere::ThreshPedPartOpen', [
      partial.auditId,
      BigInt(partial.auditorId),
      partial.partialBlindingCommit,
      partial.dleqNonce,
    ]);
    if (expectedC !== partial.challenge) return false;

    const lhs = modPow(this.h, modNorm(partial.response, this.q), this.p);
    const rhs = (partial.dleqNonce * modPow(partial.partialBlindingCommit, partial.challenge, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Combines any t honest auditor partial openings to verify that `valueCommitment` opens to `claimedValue`,
   * filtering out any faulty auditor submissions cleanly.
   */
  public combineAndVerifyAuditOpening(
    commitment: ThresholdPedersenCommitment,
    claimedValue: bigint,
    submittedPartials: readonly PartialOpeningShare[]
  ): {
    valid: boolean;
    proof?: JointAuditOpeningProof;
    faultyAuditors: number[];
    reason?: string;
  } {
    const seen = new Set<number>();
    const validPartials: PartialOpeningShare[] = [];
    const faultyAuditors: number[] = [];

    for (const part of submittedPartials) {
      if (
        part.auditId !== commitment.auditId ||
        seen.has(part.auditorId) ||
        !this.verifyPartialOpening(part, commitment.blindingPolynomialCommits)
      ) {
        faultyAuditors.push(part.auditorId);
        continue;
      }
      seen.add(part.auditorId);
      validPartials.push(part);
    }

    if (validPartials.length < commitment.threshold) {
      return {
        valid: false,
        faultyAuditors,
        reason: `Insufficient honest auditors: got ${validPartials.length}, need ${commitment.threshold}`,
      };
    }

    const chosen = validPartials.slice(0, commitment.threshold);
    const subsetIds = chosen.map((p) => p.auditorId);
    let reconstructedBlindingCommit = 1n;
    for (const p of chosen) {
      const lambda = this.lagrangeCoefficient(p.auditorId, subsetIds);
      reconstructedBlindingCommit =
        (reconstructedBlindingCommit * modPow(p.partialBlindingCommit, lambda, this.p)) % this.p;
    }

    const expectedCommit =
      (modPow(this.g, modNorm(claimedValue, this.q), this.p) * reconstructedBlindingCommit) % this.p;
    if (expectedCommit !== commitment.valueCommitment) {
      return {
        valid: false,
        faultyAuditors,
        reason: 'Claimed audit value does not match threshold Pedersen commitment',
      };
    }

    const openingDigest = createHash('sha256')
      .update(`${commitment.auditId}|val:${claimedValue}|aud:${subsetIds.join(',')}|C:${commitment.valueCommitment.toString(16)}`)
      .digest('hex');

    return {
      valid: true,
      faultyAuditors,
      proof: {
        auditId: commitment.auditId,
        claimedValue,
        valueCommitment: commitment.valueCommitment,
        participatingAuditors: subsetIds,
        partialShares: chosen,
        reconstructedBlindingCommit,
        openingDigest,
      },
    };
  }

  public serializeOpeningProof(proof: JointAuditOpeningProof): string {
    return JSON.stringify({
      ...proof,
      claimedValue: proof.claimedValue.toString(),
      valueCommitment: proof.valueCommitment.toString(16),
      reconstructedBlindingCommit: proof.reconstructedBlindingCommit.toString(16),
      partialShares: proof.partialShares.map((s) => ({
        ...s,
        partialBlindingCommit: s.partialBlindingCommit.toString(16),
        dleqNonce: s.dleqNonce.toString(16),
        challenge: s.challenge.toString(16),
        response: s.response.toString(16),
      })),
    });
  }
}
