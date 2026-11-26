import { createHash } from 'crypto';

/**
 * Verifiable Shamir Proactive Threshold Share Recovery
 *
 * Implements Byzantine-resilient proactive threshold share recovery over a
 * safe-prime subgroup (P = 2Q + 1) using Feldman polynomial commitments and
 * zero-sum blinded Lagrange helper sub-shares. Allows a lost or rebooted node
 * r to reconstruct its exact secret share f(r) from any t honest helper nodes
 * without reconstructing or exposing the master secret f(0).
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n; // Quadratic residue generator of order Q

export interface FeldmanCommitment {
  readonly degree: number;
  readonly commitments: readonly bigint[];
  readonly commitmentDigest: string;
}

export interface ThresholdShare {
  readonly participantId: number;
  readonly shareValue: bigint;
  readonly publicSharePoint: bigint;
}

export interface RecoveryHelperSubShare {
  readonly helperId: number;
  readonly targetId: number;
  readonly blindedContribution: bigint;
  readonly blindingMaskPoint: bigint;
  readonly helperDigest: string;
}

export interface ShareRecoveryResult {
  readonly isValid: boolean;
  readonly targetId: number;
  readonly recoveredShare: bigint;
  readonly verifiedPublicPoint: bigint;
  readonly helperIds: readonly number[];
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
  if (val === 0n) {
    throw new Error('Zero is not invertible mod Q');
  }
  return modPow(val, SUBGROUP_ORDER - 2n, SUBGROUP_ORDER);
}

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(part);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function commitDigest(commitments: readonly bigint[]): string {
  const h = createHash('sha256');
  h.update('FELDMAN_COMMIT|');
  h.update(String(commitments.length));
  for (const c of commitments) {
    h.update('|');
    h.update(c.toString(16));
  }
  return h.digest('hex');
}

export class ProactiveShareRecovery {
  private readonly threshold: number;
  private readonly totalParticipants: number;

  constructor(threshold: number, totalParticipants: number) {
    if (!Number.isInteger(threshold) || !Number.isInteger(totalParticipants)) {
      throw new Error('threshold and totalParticipants must be integers');
    }
    if (threshold < 2 || threshold > totalParticipants) {
      throw new Error('Require 2 <= threshold <= totalParticipants');
    }
    this.threshold = threshold;
    this.totalParticipants = totalParticipants;
  }

  public getThreshold(): number {
    return this.threshold;
  }

  public dealShares(
    masterValue: bigint,
    dealingLabel: string
  ): {
    commitment: FeldmanCommitment;
    shares: readonly ThresholdShare[];
  } {
    const coeffs: bigint[] = [modQ(masterValue)];
    for (let k = 1; k < this.threshold; k++) {
      coeffs.push(hashToScalar('PSR_DEAL_COEFF', [dealingLabel, String(k)]));
    }

    const commitments = coeffs.map((c) => modPow(SUBGROUP_GEN, c, SAFE_PRIME));
    const commitment: FeldmanCommitment = {
      degree: this.threshold - 1,
      commitments,
      commitmentDigest: commitDigest(commitments),
    };

    const shares: ThresholdShare[] = [];
    for (let id = 1; id <= this.totalParticipants; id++) {
      const x = BigInt(id);
      let y = 0n;
      let xPow = 1n;
      for (let k = 0; k < coeffs.length; k++) {
        y = modQ(y + modQ(coeffs[k] * xPow));
        xPow = modQ(xPow * x);
      }
      const publicSharePoint = modPow(SUBGROUP_GEN, y, SAFE_PRIME);
      shares.push({ participantId: id, shareValue: y, publicSharePoint });
    }

    return { commitment, shares };
  }

  public computeExpectedPublicPoint(
    commitment: FeldmanCommitment,
    participantId: number
  ): bigint {
    const x = BigInt(participantId);
    let expected = 1n;
    let xPow = 1n;
    for (let k = 0; k < commitment.commitments.length; k++) {
      const term = modPow(commitment.commitments[k], xPow, SAFE_PRIME);
      expected = modP(expected * term);
      xPow = modQ(xPow * x);
    }
    return expected;
  }

  public verifyShare(share: ThresholdShare, commitment: FeldmanCommitment): boolean {
    if (commitDigest(commitment.commitments) !== commitment.commitmentDigest) {
      return false;
    }
    const lhs = modPow(SUBGROUP_GEN, modQ(share.shareValue), SAFE_PRIME);
    const rhs = this.computeExpectedPublicPoint(commitment, share.participantId);
    return lhs === rhs && lhs === share.publicSharePoint;
  }

  public computeLagrangeCoefficientAt(
    helperId: number,
    helperIds: readonly number[],
    evalPoint: number
  ): bigint {
    const xTarget = BigInt(evalPoint);
    const xI = BigInt(helperId);
    let num = 1n;
    let den = 1n;
    for (const otherId of helperIds) {
      if (otherId === helperId) continue;
      const xJ = BigInt(otherId);
      num = modQ(num * modQ(xTarget - xJ));
      den = modQ(den * modQ(xI - xJ));
    }
    return modQ(num * modInverseQ(den));
  }

  public generateHelperContributions(
    helperShares: readonly ThresholdShare[],
    targetId: number,
    recoveryNonce: string
  ): readonly RecoveryHelperSubShare[] {
    if (helperShares.length < this.threshold) {
      throw new Error(`Need at least ${this.threshold} helper shares for recovery`);
    }
    if (targetId < 1 || targetId > this.totalParticipants) {
      throw new Error(`Invalid target participant ID: ${targetId}`);
    }

    const selected = helperShares.slice(0, this.threshold);
    const helperIds = selected.map((s) => s.participantId);
    if (helperIds.includes(targetId)) {
      throw new Error('Lost target participant cannot act as its own recovery helper');
    }
    if (new Set(helperIds).size !== helperIds.length) {
      throw new Error('Duplicate helper IDs are not permitted');
    }

    // Generate deterministic pairwise zero-sum blinding masks so sum_i delta_i == 0 mod Q
    const zeroSumMasks = new Map<number, bigint>();
    for (const id of helperIds) {
      zeroSumMasks.set(id, 0n);
    }
    for (let i = 0; i < helperIds.length; i++) {
      for (let j = i + 1; j < helperIds.length; j++) {
        const a = helperIds[i];
        const b = helperIds[j];
        const pairMask = hashToScalar('PSR_ZERO_SUM_MASK', [
          recoveryNonce,
          String(targetId),
          String(Math.min(a, b)),
          String(Math.max(a, b)),
        ]);
        zeroSumMasks.set(a, modQ(zeroSumMasks.get(a)! + pairMask));
        zeroSumMasks.set(b, modQ(zeroSumMasks.get(b)! - pairMask));
      }
    }

    return selected.map((share) => {
      const lambda = this.computeLagrangeCoefficientAt(share.participantId, helperIds, targetId);
      const mask = zeroSumMasks.get(share.participantId)!;
      const blindedContribution = modQ(modQ(share.shareValue * lambda) + mask);
      const blindingMaskPoint = modPow(SUBGROUP_GEN, mask, SAFE_PRIME);
      const helperDigest = createHash('sha256')
        .update('PSR_HELPER_CONTRIB|')
        .update(`${share.participantId}|${targetId}|${recoveryNonce}|`)
        .update(`${blindedContribution.toString(16)}|${blindingMaskPoint.toString(16)}`)
        .digest('hex');

      return {
        helperId: share.participantId,
        targetId,
        blindedContribution,
        blindingMaskPoint,
        helperDigest,
      };
    });
  }

  public recoverShare(
    targetId: number,
    contributions: readonly RecoveryHelperSubShare[],
    commitment: FeldmanCommitment,
    recoveryNonce: string
  ): ShareRecoveryResult {
    if (contributions.length < this.threshold) {
      return {
        isValid: false,
        targetId,
        recoveredShare: 0n,
        verifiedPublicPoint: 0n,
        helperIds: [],
        reason: `Insufficient helper contributions: got ${contributions.length}, need ${this.threshold}`,
      };
    }

    if (commitDigest(commitment.commitments) !== commitment.commitmentDigest) {
      return {
        isValid: false,
        targetId,
        recoveredShare: 0n,
        verifiedPublicPoint: 0n,
        helperIds: [],
        reason: 'Feldman commitment digest integrity check failed',
      };
    }

    const helperIds = contributions.map((c) => c.helperId);
    if (new Set(helperIds).size !== helperIds.length) {
      return {
        isValid: false,
        targetId,
        recoveredShare: 0n,
        verifiedPublicPoint: 0n,
        helperIds,
        reason: 'Duplicate helper contribution detected',
      };
    }

    let maskProduct = 1n;
    let recovered = 0n;

    for (const contrib of contributions) {
      if (contrib.targetId !== targetId) {
        return {
          isValid: false,
          targetId,
          recoveredShare: 0n,
          verifiedPublicPoint: 0n,
          helperIds,
          reason: `Helper ${contrib.helperId} target mismatch`,
        };
      }

      const expectedDigest = createHash('sha256')
        .update('PSR_HELPER_CONTRIB|')
        .update(`${contrib.helperId}|${targetId}|${recoveryNonce}|`)
        .update(`${contrib.blindedContribution.toString(16)}|${contrib.blindingMaskPoint.toString(16)}`)
        .digest('hex');

      if (expectedDigest !== contrib.helperDigest) {
        return {
          isValid: false,
          targetId,
          recoveredShare: 0n,
          verifiedPublicPoint: 0n,
          helperIds,
          reason: `Helper ${contrib.helperId} digest verification failed`,
        };
      }

      // Verify g^{blinded_i} == (g^{f(i)})^{lambda_i} * g^{mask_i}
      const lambda = this.computeLagrangeCoefficientAt(contrib.helperId, helperIds, targetId);
      const helperPubPoint = this.computeExpectedPublicPoint(commitment, contrib.helperId);
      const expectedContribPoint = modP(
        modPow(helperPubPoint, lambda, SAFE_PRIME) * contrib.blindingMaskPoint
      );
      const actualContribPoint = modPow(SUBGROUP_GEN, modQ(contrib.blindedContribution), SAFE_PRIME);

      if (actualContribPoint !== expectedContribPoint) {
        return {
          isValid: false,
          targetId,
          recoveredShare: 0n,
          verifiedPublicPoint: 0n,
          helperIds,
          reason: `Byzantine/corrupted sub-share detected from helper ${contrib.helperId}`,
        };
      }

      maskProduct = modP(maskProduct * contrib.blindingMaskPoint);
      recovered = modQ(recovered + contrib.blindedContribution);
    }

    if (maskProduct !== 1n) {
      return {
        isValid: false,
        targetId,
        recoveredShare: 0n,
        verifiedPublicPoint: 0n,
        helperIds,
        reason: 'Zero-sum blinding mask cancellation check failed',
      };
    }

    const expectedTargetPub = this.computeExpectedPublicPoint(commitment, targetId);
    const recoveredPub = modPow(SUBGROUP_GEN, recovered, SAFE_PRIME);
    if (recoveredPub !== expectedTargetPub) {
      return {
        isValid: false,
        targetId,
        recoveredShare: 0n,
        verifiedPublicPoint: recoveredPub,
        helperIds,
        reason: 'Recovered share does not match target Feldman public commitment',
      };
    }

    return {
      isValid: true,
      targetId,
      recoveredShare: recovered,
      verifiedPublicPoint: recoveredPub,
      helperIds,
    };
  }
}
