/**
 * @file VerifiableShamirsSecretAuditProver.ts
 * @description Information-Theoretically Hiding Pedersen Verifiable Secret Sharing (Pedersen-VSS)
 * with Disputed-Share Adjudication, Cheater-Tolerant Lagrange Reconstruction, Batch Share Auditing,
 * and Portable JSON Serialization.
 * Unlike standard Feldman-VSS (which leaks g^S), Pedersen-VSS commits to BOTH the secret polynomial
 * f(x) and an independent blinding polynomial r(x) via C_k = g^{f_k} * h^{r_k} mod p, achieving
 * unconditional information-theoretic secrecy of the shared secret S!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface PedersenVSSShare {
  participantId: number;
  secretEvalF: bigint;
  blindingEvalR: bigint;
}

export interface PedersenVSSDeal {
  dealId: string;
  threshold: number;
  totalParticipants: number;
  commitments: bigint[]; // C_k = g^{a_k} * h^{b_k} mod p
  shares: PedersenVSSShare[];
  dealDigest: string;
}

export interface ShareDisputeVerdict {
  dealId: string;
  participantId: number;
  shareValid: boolean;
  expectedCommitment: bigint;
  actualCommitment: bigint;
  verdictDigest: string;
}

export interface ReconstructedPedersenSecret {
  dealId: string;
  secretValue: bigint;
  secretBlinding: bigint;
  verifiedAgainstC0: boolean;
  usedParticipants: number[];
  rejectedParticipants: number[];
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
  const digest = createHash('sha256').update(`WorkSphere::PedersenVSSH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
  const raw = BigInt(`0x${digest}`) % (p - 2n) + 2n;
  return (raw * raw) % p;
}

/**
 * Unconditionally Hiding Pedersen Verifiable Secret Sharing (VSS) Engine.
 */
export class VerifiableShamirsSecretAuditProver {
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

  public commit(val: bigint, blind: bigint): bigint {
    return (
      modPow(this.g, modNorm(val, this.q), this.p) *
      modPow(this.h, modNorm(blind, this.q), this.p)
    ) % this.p;
  }

  private evaluatePoly(coeffs: readonly bigint[], x: bigint): bigint {
    let acc = 0n;
    const xn = modNorm(x, this.q);
    for (let i = coeffs.length - 1; i >= 0; i--) {
      acc = modNorm(acc * xn + coeffs[i], this.q);
    }
    return acc;
  }

  /**
   * Deals a (threshold, totalParticipants) Pedersen-VSS sharing of `secretValue`.
   */
  public dealSecret(
    dealId: string,
    secretValue: bigint,
    threshold: number,
    totalParticipants: number
  ): PedersenVSSDeal {
    if (threshold < 1 || threshold > totalParticipants) {
      throw new RangeError('Threshold must satisfy 1 <= t <= n');
    }

    const secretCoeffs: bigint[] = [modNorm(secretValue, this.q)];
    const blindCoeffs: bigint[] = [randomScalar(this.q)];
    for (let k = 1; k < threshold; k++) {
      secretCoeffs.push(randomScalar(this.q));
      blindCoeffs.push(randomScalar(this.q));
    }

    const commitments: bigint[] = [];
    for (let k = 0; k < threshold; k++) {
      commitments.push(this.commit(secretCoeffs[k], blindCoeffs[k]));
    }

    const shares: PedersenVSSShare[] = [];
    for (let id = 1; id <= totalParticipants; id++) {
      const x = BigInt(id);
      shares.push({
        participantId: id,
        secretEvalF: this.evaluatePoly(secretCoeffs, x),
        blindingEvalR: this.evaluatePoly(blindCoeffs, x),
      });
    }

    const dealDigest = createHash('sha256')
      .update(`${dealId}|t:${threshold}|n:${totalParticipants}|${commitments.map((c) => c.toString(16)).join(',')}`)
      .digest('hex');

    return {
      dealId,
      threshold,
      totalParticipants,
      commitments,
      shares,
      dealDigest,
    };
  }

  /**
   * Evaluates the expected share commitment Prod_{k=0}^{t-1} C_k^{id^k} mod p.
   */
  public expectedShareCommitment(participantId: number, commitments: readonly bigint[]): bigint {
    const x = BigInt(participantId);
    let acc = 1n;
    let xPow = 1n;
    for (const c of commitments) {
      acc = (acc * modPow(c, xPow, this.p)) % this.p;
      xPow = modNorm(xPow * x, this.q);
    }
    return acc;
  }

  /**
   * Verifies a single participant's dual Pedersen-VSS share (f(i), r(i)) against commitments.
   */
  public verifyShare(share: PedersenVSSShare, commitments: readonly bigint[]): boolean {
    const actual = this.commit(share.secretEvalF, share.blindingEvalR);
    const expected = this.expectedShareCommitment(share.participantId, commitments);
    return actual === expected;
  }

  /**
   * Adjudicates a disputed share and emits a signed-style verdict record.
   */
  public adjudicateDispute(
    dealId: string,
    share: PedersenVSSShare,
    commitments: readonly bigint[]
  ): ShareDisputeVerdict {
    const actualCommitment = this.commit(share.secretEvalF, share.blindingEvalR);
    const expectedCommitment = this.expectedShareCommitment(share.participantId, commitments);
    const shareValid = actualCommitment === expectedCommitment;
    const verdictDigest = createHash('sha256')
      .update(`${dealId}|p:${share.participantId}|valid:${shareValid}|${actualCommitment.toString(16)}`)
      .digest('hex');

    return {
      dealId,
      participantId: share.participantId,
      shareValid,
      expectedCommitment,
      actualCommitment,
      verdictDigest,
    };
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
   * Reconstructs the secret and blinding scalar using ONLY verified honest shares, automatically
   * filtering out corrupted/duplicate shares and proving g^S * h^R == C_0!
   */
  public reconstructFaultTolerant(
    dealId: string,
    submittedShares: readonly PedersenVSSShare[],
    commitments: readonly bigint[]
  ): ReconstructedPedersenSecret {
    const threshold = commitments.length;
    const seen = new Set<number>();
    const validShares: PedersenVSSShare[] = [];
    const rejectedParticipants: number[] = [];

    for (const sh of submittedShares) {
      if (seen.has(sh.participantId) || !this.verifyShare(sh, commitments)) {
        rejectedParticipants.push(sh.participantId);
        continue;
      }
      seen.add(sh.participantId);
      validShares.push(sh);
    }

    if (validShares.length < threshold) {
      throw new Error(`Need at least ${threshold} honest shares, found ${validShares.length}`);
    }

    const chosen = validShares.slice(0, threshold);
    const subsetIds = chosen.map((s) => s.participantId);

    let secretValue = 0n;
    let secretBlinding = 0n;
    for (const sh of chosen) {
      const lambda = this.lagrangeCoefficient(sh.participantId, subsetIds);
      secretValue = modNorm(secretValue + lambda * sh.secretEvalF, this.q);
      secretBlinding = modNorm(secretBlinding + lambda * sh.blindingEvalR, this.q);
    }

    const verifiedAgainstC0 = this.commit(secretValue, secretBlinding) === commitments[0];
    return {
      dealId,
      secretValue,
      secretBlinding,
      verifiedAgainstC0,
      usedParticipants: subsetIds,
      rejectedParticipants,
    };
  }

  /**
   * Homomorphically adds two independent Pedersen-VSS deals over the same (t, n) parameters!
   */
  public homomorphicAddDeals(
    newDealId: string,
    dealA: PedersenVSSDeal,
    dealB: PedersenVSSDeal
  ): PedersenVSSDeal {
    if (dealA.threshold !== dealB.threshold || dealA.totalParticipants !== dealB.totalParticipants) {
      throw new Error('Incompatible (t, n) parameters for homomorphic VSS addition');
    }
    const commitments = dealA.commitments.map((ca, i) => (ca * dealB.commitments[i]) % this.p);
    const shares: PedersenVSSShare[] = dealA.shares.map((sa, i) => ({
      participantId: sa.participantId,
      secretEvalF: modNorm(sa.secretEvalF + dealB.shares[i].secretEvalF, this.q),
      blindingEvalR: modNorm(sa.blindingEvalR + dealB.shares[i].blindingEvalR, this.q),
    }));
    const dealDigest = createHash('sha256')
      .update(`${newDealId}|sum|${commitments[0].toString(16)}`)
      .digest('hex');

    return {
      dealId: newDealId,
      threshold: dealA.threshold,
      totalParticipants: dealA.totalParticipants,
      commitments,
      shares,
      dealDigest,
    };
  }

  public serializePublicDeal(deal: PedersenVSSDeal): string {
    return JSON.stringify({
      dealId: deal.dealId,
      threshold: deal.threshold,
      totalParticipants: deal.totalParticipants,
      commitments: deal.commitments.map((c) => c.toString(16)),
      dealDigest: deal.dealDigest,
    });
  }

  /**
   * Batch-audits every participant's share in a Pedersen-VSS deal, returning complete
   * per-participant verdicts and a cryptographic audit digest.
   */
  public auditAllDealShares(deal: PedersenVSSDeal): {
    allValid: boolean;
    validParticipantIds: number[];
    invalidParticipantIds: number[];
    verdicts: ShareDisputeVerdict[];
    auditDigest: string;
  } {
    const validParticipantIds: number[] = [];
    const invalidParticipantIds: number[] = [];
    const verdicts: ShareDisputeVerdict[] = [];

    for (const share of deal.shares) {
      const verdict = this.adjudicateDispute(deal.dealId, share, deal.commitments);
      verdicts.push(verdict);
      if (verdict.shareValid) validParticipantIds.push(share.participantId);
      else invalidParticipantIds.push(share.participantId);
    }

    const auditDigest = createHash('sha256')
      .update(
        `WorkSphere::PVSSAudit|${deal.dealId}|v:${validParticipantIds.join(',')}|bad:${invalidParticipantIds.join(',')}`
      )
      .digest('hex');

    return {
      allValid: invalidParticipantIds.length === 0 && validParticipantIds.length === deal.totalParticipants,
      validParticipantIds,
      invalidParticipantIds,
      verdicts,
      auditDigest,
    };
  }

  /**
   * Multiplies a Pedersen-VSS deal homomorphically by a public field scalar c mod q.
   */
  public homomorphicScaleDeal(
    newDealId: string,
    deal: PedersenVSSDeal,
    publicScalar: bigint
  ): PedersenVSSDeal {
    const c = modNorm(publicScalar, this.q);
    const commitments = deal.commitments.map((cm) => modPow(cm, c, this.p));
    const shares: PedersenVSSShare[] = deal.shares.map((s) => ({
      participantId: s.participantId,
      secretEvalF: modNorm(c * s.secretEvalF, this.q),
      blindingEvalR: modNorm(c * s.blindingEvalR, this.q),
    }));
    const dealDigest = createHash('sha256')
      .update(`${newDealId}|scale:${c.toString(16)}|${commitments[0].toString(16)}`)
      .digest('hex');
    return {
      dealId: newDealId,
      threshold: deal.threshold,
      totalParticipants: deal.totalParticipants,
      commitments,
      shares,
      dealDigest,
    };
  }
}
