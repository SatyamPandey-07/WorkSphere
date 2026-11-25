import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Self-Healing Secret Share Recovery Prover.
 *
 * Implements Herzberg-style zero-knowledge lost-share recovery for (t, n) Feldman-VSS
 * threshold groups WITHOUT reconstructing the master secret f(0) at any node:
 *  - Suppose participant r loses its secret share f(r).
 *  - A quorum H of t healthy helper nodes (r not in H) collaborate to recover f(r):
 *    1. Each helper h in H samples a degree-(t-1) masking polynomial z_h(x) such that
 *         z_h(r) == 0  (vanishes at target r!)
 *       and publishes Feldman commitments Z_{h,k} = g^{z_{h,k}} verifying prod Z_{h,k}^{r^k} == 1.
 *    2. Helper h computes its masked blinded share:
 *         s'_h = f(h) + sum_{j in H} z_j(h) mod Q
 *       and sends s'_h ONLY to target node r along with a Feldman validity check!
 *    3. Target node r performs Lagrange interpolation at x = r (NOT x = 0!) over {(h, s'_h)}:
 *         F'(r) = f(r) + sum_{j in H} z_j(r) = f(r) + 0 == f(r)!!
 *    4. Target node r verifies g^{recoveredShare} == prod C_k^{r^k} against public Feldman
 *       commitments, and any malicious helper sending a corrupted contribution is isolated!
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

function modInv(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = ((a % m) + m) % m;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
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

export interface NodeShare {
  id: number;
  secretShare: bigint;
  publicShare: bigint;
}

export interface VSSGroupSetup {
  groupId: string;
  threshold: number;
  groupPublicKey: bigint;
  feldmanCommitments: bigint[];
  shares: NodeShare[];
}

export interface ZeroAtTargetMaskDeal {
  helperId: number;
  targetId: number;
  maskCommitments: bigint[]; // Feldman commitments of z_h(x) satisfying prod Z_k^{targetId^k} == 1
  evaluationsAtHelpers: Record<number, bigint>;
}

export interface MaskedRecoveryContribution {
  helperId: number;
  targetId: number;
  maskedShareValue: bigint; // f(helperId) + sum_{j in H} z_j(helperId)
}

export interface ShareRecoveryResult {
  targetId: number;
  recovered: boolean;
  recoveredShare?: bigint;
  recoveredPublicShare?: bigint;
  verifiedHelperIds: number[];
  faultyHelperIds: number[];
  recoveryDigest: string;
}

export class VerifiableSecretShareRecoveryProver {
  public evalPoly(coeffs: bigint[], x: bigint): bigint {
    let acc = 0n;
    let xp = 1n;
    for (const c of coeffs) {
      acc = modScalar(acc + c * xp);
      xp = modScalar(xp * x);
    }
    return acc;
  }

  public evalCommitments(commitments: bigint[], x: bigint): bigint {
    let acc = 1n;
    let xp = 1n;
    for (const ck of commitments) {
      acc = (acc * modPow(ck, xp, SAFE_PRIME_P)) % SAFE_PRIME_P;
      xp = modScalar(xp * x);
    }
    return acc;
  }

  public setupGroup(groupId: string, threshold: number, participantIds: number[], secret?: bigint): { setup: VSSGroupSetup; masterSecret: bigint } {
    if (threshold < 2 || threshold > participantIds.length) {
      throw new RangeError('Threshold must be in [2, participantIds.length]');
    }
    const masterSecret = secret !== undefined ? modScalar(secret) : randomScalar();
    const coeffs = [masterSecret];
    for (let k = 1; k < threshold; k++) coeffs.push(randomScalar());
    const feldmanCommitments = coeffs.map((c) => modPow(BASE_G, c, SAFE_PRIME_P));
    const shares: NodeShare[] = participantIds.map((id) => {
      const s = this.evalPoly(coeffs, BigInt(id));
      return { id, secretShare: s, publicShare: modPow(BASE_G, s, SAFE_PRIME_P) };
    });

    return {
      setup: { groupId, threshold, groupPublicKey: feldmanCommitments[0], feldmanCommitments, shares },
      masterSecret,
    };
  }

  /**
   * Builds a random degree-(threshold - 1) polynomial z(x) vanishing at x = targetId (z(targetId) == 0).
   */
  public createZeroAtTargetMask(
    helperId: number,
    targetId: number,
    threshold: number,
    helperIds: number[],
  ): ZeroAtTargetMaskDeal {
    // Pick random higher coefficients a_1..a_{t-1}, then solve a_0 = -sum_{k=1}^{t-1} a_k * targetId^k mod Q
    const coeffs = new Array<bigint>(threshold).fill(0n);
    const r = BigInt(targetId);
    let higherAtR = 0n;
    let rPow = r;
    for (let k = 1; k < threshold; k++) {
      coeffs[k] = randomScalar();
      higherAtR = modScalar(higherAtR + coeffs[k] * rPow);
      rPow = modScalar(rPow * r);
    }
    coeffs[0] = modScalar(SUBGROUP_Q - higherAtR);

    const maskCommitments = coeffs.map((c) => modPow(BASE_G, c, SAFE_PRIME_P));
    const evaluationsAtHelpers: Record<number, bigint> = {};
    for (const h of helperIds) {
      evaluationsAtHelpers[h] = this.evalPoly(coeffs, BigInt(h));
    }

    return { helperId, targetId, maskCommitments, evaluationsAtHelpers };
  }

  public verifyZeroAtTargetMask(deal: ZeroAtTargetMaskDeal, expectedThreshold: number): boolean {
    if (deal.maskCommitments.length !== expectedThreshold) return false;
    // CRITICAL: z(targetId) MUST equal 0 => prod Z_k^{targetId^k} == g^0 == 1!
    if (this.evalCommitments(deal.maskCommitments, BigInt(deal.targetId)) !== 1n) return false;

    for (const [hidStr, val] of Object.entries(deal.evaluationsAtHelpers)) {
      const hid = Number(hidStr);
      const expectedPub = this.evalCommitments(deal.maskCommitments, BigInt(hid));
      if (modPow(BASE_G, val, SAFE_PRIME_P) !== expectedPub) return false;
    }
    return true;
  }

  public computeHelperContribution(
    helperShare: NodeShare,
    targetId: number,
    validMaskDeals: ZeroAtTargetMaskDeal[],
    corruptDelta = 0n,
  ): MaskedRecoveryContribution {
    let masked = helperShare.secretShare;
    for (const deal of validMaskDeals) {
      const evalAtHelper = deal.evaluationsAtHelpers[helperShare.id];
      if (evalAtHelper === undefined) {
        throw new Error(`Mask deal from helper ${deal.helperId} missing evaluation for helper ${helperShare.id}`);
      }
      masked = modScalar(masked + evalAtHelper);
    }
    if (corruptDelta !== 0n) {
      masked = modScalar(masked + corruptDelta);
    }
    return { helperId: helperShare.id, targetId, maskedShareValue: masked };
  }

  public verifyHelperContribution(
    setup: VSSGroupSetup,
    validMaskDeals: ZeroAtTargetMaskDeal[],
    contribution: MaskedRecoveryContribution,
  ): boolean {
    // Expected commitment at helperId: prod C_k^{h^k} * prod_{deals} prod Z_{j,k}^{h^k}
    const h = BigInt(contribution.helperId);
    let expected = this.evalCommitments(setup.feldmanCommitments, h);
    for (const deal of validMaskDeals) {
      expected = (expected * this.evalCommitments(deal.maskCommitments, h)) % SAFE_PRIME_P;
    }
    return modPow(BASE_G, contribution.maskedShareValue, SAFE_PRIME_P) === expected;
  }

  /**
   * Lagrange interpolation evaluated at arbitrary target point xTarget (NOT just x = 0!).
   */
  public lagrangeInterpolateAt(points: Array<{ x: bigint; y: bigint }>, xTarget: bigint): bigint {
    let acc = 0n;
    for (let i = 0; i < points.length; i++) {
      const xi = points[i].x;
      let num = 1n;
      let den = 1n;
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        const xj = points[j].x;
        num = modScalar(num * modScalar(xTarget - xj));
        den = modScalar(den * modScalar(xi - xj));
      }
      const lambda = modScalar(num * modInv(den, SUBGROUP_Q));
      acc = modScalar(acc + lambda * points[i].y);
    }
    return acc;
  }

  public recoverLostShare(
    setup: VSSGroupSetup,
    targetId: number,
    maskDeals: ZeroAtTargetMaskDeal[],
    contributions: MaskedRecoveryContribution[],
  ): ShareRecoveryResult {
    const validMasks = maskDeals.filter((d) => d.targetId === targetId && this.verifyZeroAtTargetMask(d, setup.threshold));
    const verified: MaskedRecoveryContribution[] = [];
    const faultyHelperIds: number[] = [];
    const seen = new Set<number>();

    for (const c of contributions) {
      if (
        c.targetId !== targetId ||
        c.helperId === targetId ||
        seen.has(c.helperId) ||
        !this.verifyHelperContribution(setup, validMasks, c)
      ) {
        faultyHelperIds.push(c.helperId);
        continue;
      }
      seen.add(c.helperId);
      verified.push(c);
    }

    if (verified.length < setup.threshold) {
      return {
        targetId,
        recovered: false,
        verifiedHelperIds: verified.map((v) => v.helperId),
        faultyHelperIds,
        recoveryDigest: sha256Hex('SHARE-REC-FAIL', setup.groupId, String(targetId)),
      };
    }

    const quorum = verified.slice(0, setup.threshold);
    const recoveredShare = this.lagrangeInterpolateAt(
      quorum.map((q) => ({ x: BigInt(q.helperId), y: q.maskedShareValue })),
      BigInt(targetId),
    );
    const recoveredPublicShare = modPow(BASE_G, recoveredShare, SAFE_PRIME_P);
    const expectedPub = this.evalCommitments(setup.feldmanCommitments, BigInt(targetId));

    if (recoveredPublicShare !== expectedPub) {
      return {
        targetId,
        recovered: false,
        verifiedHelperIds: quorum.map((q) => q.helperId),
        faultyHelperIds,
        recoveryDigest: sha256Hex('SHARE-REC-VERIFY-FAIL', setup.groupId, String(targetId)),
      };
    }

    return {
      targetId,
      recovered: true,
      recoveredShare,
      recoveredPublicShare,
      verifiedHelperIds: quorum.map((q) => q.helperId),
      faultyHelperIds,
      recoveryDigest: sha256Hex(
        'SHARE-REC-OK-V1',
        setup.groupId,
        String(targetId),
        recoveredPublicShare.toString(16),
        ...quorum.map((q) => String(q.helperId)),
      ),
    };
  }

  public serializeResult(res: ShareRecoveryResult): string {
    return JSON.stringify({
      targetId: res.targetId,
      recovered: res.recovered,
      verifiedHelperIds: res.verifiedHelperIds,
      faultyHelperIds: res.faultyHelperIds,
      recoveryDigest: res.recoveryDigest,
    });
  }
}
