/**
 * @file VerifiableSecretResharingProver.ts
 * @description Proactive Verifiable Secret Resharing (PVSR) & Committee Handover Prover.
 * Allows an active (t1, n1) committee holding shares of a master secret S (with group public key
 * Y = g^S mod p) to transition seamlessly to a completely new (t2, n2) committee and fresh epoch
 * shares WITHOUT EVER RECONSTRUCTING S and WHILE KEEPING Y = g^S INVARIANT:
 *   1. Each old committee member i deals their share s_i using a fresh degree-(t2-1) polynomial
 *      f_i(x) with f_i(0) = s_i and broadcasts Feldman commitments C_{i,k} = g^{a_{i,k}}.
 *   2. Every new member j verifies each sub-share s_{i -> j} AND verifies C_{i,0} == Y_i.
 *   3. New member j computes s'_j = Sum_{i in Q} lambda_i(0) * s_{i -> j} mod q.
 *   4. Guarantees forward/backward secrecy (old shares cannot combine with new shares) and
 *      invariant group public key across arbitrary epoch handovers.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface CommitteeShare {
  epoch: number;
  memberId: number;
  secretShare: bigint;
  publicShare: bigint;
}

export interface CommitteeEpochState {
  epoch: number;
  threshold: number;
  memberIds: number[];
  groupPublicKey: bigint;
  shares: CommitteeShare[];
}

export interface ResharingDealerPackage {
  fromEpoch: number;
  toEpoch: number;
  oldMemberId: number;
  oldPublicShare: bigint;
  subCommitments: bigint[];
  subShares: Map<number, bigint>;
  dealerSchnorrProof: {
    nonceCommit: bigint;
    challenge: bigint;
    response: bigint;
  };
}

export interface ResharingHandoverAudit {
  fromEpoch: number;
  toEpoch: number;
  oldThreshold: number;
  newThreshold: number;
  groupPublicKeyInvariant: boolean;
  validOldDealers: number[];
  faultyOldDealers: number[];
  newEpochState: CommitteeEpochState;
  handoverDigest: string;
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
 * Proactive Verifiable Secret Resharing & Dynamic Committee Handover Coordinator.
 */
export class VerifiableSecretResharingProver {
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
   * Initializes Epoch 1 with a (threshold, memberIds) Shamir secret sharing of a random secret.
   */
  public initializeGenesisEpoch(
    threshold: number,
    memberIds: readonly number[],
    fixedSecret?: bigint
  ): CommitteeEpochState {
    if (threshold < 1 || threshold > memberIds.length) {
      throw new RangeError('Invalid genesis threshold');
    }
    const secret = fixedSecret !== undefined
      ? modNorm(fixedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);

    const coeffs = [secret];
    for (let k = 1; k < threshold; k++) {
      coeffs.push(randomScalar(this.q));
    }

    const groupPublicKey = modPow(this.g, secret, this.p);
    const shares: CommitteeShare[] = memberIds.map((memberId) => {
      const x = BigInt(memberId);
      let s = 0n;
      let xPow = 1n;
      for (const c of coeffs) {
        s = modNorm(s + c * xPow, this.q);
        xPow = modNorm(xPow * x, this.q);
      }
      return {
        epoch: 1,
        memberId,
        secretShare: s,
        publicShare: modPow(this.g, s, this.p),
      };
    });

    return {
      epoch: 1,
      threshold,
      memberIds: [...memberIds],
      groupPublicKey,
      shares,
    };
  }

  /**
   * An old committee member re-shares their existing secret share into a new degree-(newThreshold-1)
   * polynomial targeted at `newMemberIds` for `toEpoch`.
   */
  public createResharingPackage(
    oldShare: CommitteeShare,
    newThreshold: number,
    newMemberIds: readonly number[],
    toEpoch: number
  ): ResharingDealerPackage {
    if (newThreshold < 1 || newThreshold > newMemberIds.length) {
      throw new RangeError('Invalid target committee threshold');
    }

    const coeffs: bigint[] = [oldShare.secretShare];
    for (let k = 1; k < newThreshold; k++) {
      coeffs.push(randomScalar(this.q));
    }
    const subCommitments = coeffs.map((c) => modPow(this.g, c, this.p));

    const subShares = new Map<number, bigint>();
    for (const newId of newMemberIds) {
      const x = BigInt(newId);
      let y = 0n;
      let xPow = 1n;
      for (const c of coeffs) {
        y = modNorm(y + c * xPow, this.q);
        xPow = modNorm(xPow * x, this.q);
      }
      subShares.set(newId, y);
    }

    // Schnorr proof tying the constant term to oldShare.publicShare for this handover epoch
    const k = randomScalar(this.q);
    const nonceCommit = modPow(this.g, k, this.p);
    const challenge = hashScalar('WorkSphere::PVSRDealerPoP', [
      BigInt(oldShare.epoch),
      BigInt(toEpoch),
      BigInt(oldShare.memberId),
      oldShare.publicShare,
      nonceCommit,
    ]);
    const response = modNorm(k + challenge * oldShare.secretShare, this.q);

    return {
      fromEpoch: oldShare.epoch,
      toEpoch,
      oldMemberId: oldShare.memberId,
      oldPublicShare: oldShare.publicShare,
      subCommitments,
      subShares,
      dealerSchnorrProof: { nonceCommit, challenge, response },
    };
  }

  /**
   * Verifies a resharing dealer package against expected old public key share and new member IDs.
   */
  public verifyResharingPackage(
    pkg: ResharingDealerPackage,
    expectedOldPublicShare: bigint,
    newThreshold: number,
    newMemberIds: readonly number[]
  ): boolean {
    if (pkg.subCommitments.length !== newThreshold) return false;
    if (pkg.subCommitments[0] !== expectedOldPublicShare || pkg.oldPublicShare !== expectedOldPublicShare) {
      return false;
    }

    const sp = pkg.dealerSchnorrProof;
    const expectedC = hashScalar('WorkSphere::PVSRDealerPoP', [
      BigInt(pkg.fromEpoch),
      BigInt(pkg.toEpoch),
      BigInt(pkg.oldMemberId),
      pkg.oldPublicShare,
      sp.nonceCommit,
    ]);
    if (expectedC !== sp.challenge) return false;

    const lhsPoP = modPow(this.g, sp.response, this.p);
    const rhsPoP = (sp.nonceCommit * modPow(pkg.oldPublicShare, sp.challenge, this.p)) % this.p;
    if (lhsPoP !== rhsPoP) return false;

    for (const newId of newMemberIds) {
      const subShare = pkg.subShares.get(newId);
      if (subShare === undefined) return false;
      const lhs = modPow(this.g, modNorm(subShare, this.q), this.p);
      const x = BigInt(newId);
      let rhs = 1n;
      let xPow = 1n;
      for (const comm of pkg.subCommitments) {
        rhs = (rhs * modPow(comm, xPow, this.p)) % this.p;
        xPow = modNorm(xPow * x, this.q);
      }
      if (lhs !== rhs) return false;
    }

    return true;
  }

  /**
   * Executes the full committee handover from `oldEpoch` to a new `(newThreshold, newMemberIds)`
   * committee, auditing all dealer packages, filtering faulty dealers, recombining fresh shares,
   * and verifying groupPublicKey invariance.
   */
  public executeCommitteeHandover(
    oldEpoch: CommitteeEpochState,
    packages: readonly ResharingDealerPackage[],
    newThreshold: number,
    newMemberIds: readonly number[]
  ): ResharingHandoverAudit {
    const toEpoch = oldEpoch.epoch + 1;
    const oldPubMap = new Map(oldEpoch.shares.map((s) => [s.memberId, s.publicShare]));

    const validPackages: ResharingDealerPackage[] = [];
    const validOldDealers: number[] = [];
    const faultyOldDealers: number[] = [];
    const seenDealers = new Set<number>();

    for (const pkg of packages) {
      if (seenDealers.has(pkg.oldMemberId)) {
        faultyOldDealers.push(pkg.oldMemberId);
        continue;
      }
      seenDealers.add(pkg.oldMemberId);
      const expectedOldPub = oldPubMap.get(pkg.oldMemberId);
      if (
        expectedOldPub === undefined ||
        pkg.fromEpoch !== oldEpoch.epoch ||
        pkg.toEpoch !== toEpoch ||
        !this.verifyResharingPackage(pkg, expectedOldPub, newThreshold, newMemberIds)
      ) {
        faultyOldDealers.push(pkg.oldMemberId);
        continue;
      }
      validPackages.push(pkg);
      validOldDealers.push(pkg.oldMemberId);
    }

    if (validPackages.length < oldEpoch.threshold) {
      throw new Error(
        `Insufficient honest old committee dealers: got ${validPackages.length}, need ${oldEpoch.threshold}`
      );
    }

    const activePackages = validPackages.slice(0, oldEpoch.threshold);
    const activeDealerIds = activePackages.map((p) => p.oldMemberId);

    const newShares: CommitteeShare[] = newMemberIds.map((newId) => {
      let combined = 0n;
      for (const pkg of activePackages) {
        const lambda = this.lagrangeCoefficient(pkg.oldMemberId, activeDealerIds);
        const subShare = pkg.subShares.get(newId)!;
        combined = modNorm(combined + lambda * subShare, this.q);
      }
      return {
        epoch: toEpoch,
        memberId: newId,
        secretShare: combined,
        publicShare: modPow(this.g, combined, this.p),
      };
    });

    const newEpochState: CommitteeEpochState = {
      epoch: toEpoch,
      threshold: newThreshold,
      memberIds: [...newMemberIds],
      groupPublicKey: oldEpoch.groupPublicKey,
      shares: newShares,
    };

    const groupPublicKeyInvariant = this.verifyEpochGroupPublicKey(
      newEpochState,
      newMemberIds.slice(0, newThreshold)
    );

    const handoverDigest = createHash('sha256')
      .update(
        `WorkSphere::PVSR|${oldEpoch.epoch}->${toEpoch}|old:${activeDealerIds.join(',')}|new:${newMemberIds.join(',')}|gpk:${oldEpoch.groupPublicKey.toString(16)}`
      )
      .digest('hex');

    return {
      fromEpoch: oldEpoch.epoch,
      toEpoch,
      oldThreshold: oldEpoch.threshold,
      newThreshold,
      groupPublicKeyInvariant,
      validOldDealers,
      faultyOldDealers,
      newEpochState,
      handoverDigest,
    };
  }

  /**
   * Verifies that any t-subset of an epoch's public shares interpolates in the exponent to groupPublicKey.
   */
  public verifyEpochGroupPublicKey(
    state: CommitteeEpochState,
    subsetIds: readonly number[]
  ): boolean {
    if (subsetIds.length < state.threshold) return false;
    const shareMap = new Map(state.shares.map((s) => [s.memberId, s]));
    let acc = 1n;
    for (const id of subsetIds) {
      const share = shareMap.get(id);
      if (!share) return false;
      const lambda = this.lagrangeCoefficient(id, subsetIds);
      acc = (acc * modPow(share.publicShare, lambda, this.p)) % this.p;
    }
    return acc === state.groupPublicKey;
  }

  /**
   * Verifies proactive share refresh: confirms every overlapping member received a genuinely
   * fresh share different from their previous epoch share (forward/backward secrecy).
   */
  public verifyShareRefreshEntropy(
    oldEpoch: CommitteeEpochState,
    newEpoch: CommitteeEpochState
  ): { allRefreshed: boolean; unchangedMemberIds: number[] } {
    const oldMap = new Map(oldEpoch.shares.map((s) => [s.memberId, s.secretShare]));
    const unchangedMemberIds: number[] = [];
    for (const s of newEpoch.shares) {
      const prev = oldMap.get(s.memberId);
      if (prev !== undefined && prev === s.secretShare) {
        unchangedMemberIds.push(s.memberId);
      }
    }
    return {
      allRefreshed: unchangedMemberIds.length === 0,
      unchangedMemberIds,
    };
  }

  public serializePublicAudit(audit: ResharingHandoverAudit): string {
    return JSON.stringify({
      fromEpoch: audit.fromEpoch,
      toEpoch: audit.toEpoch,
      oldThreshold: audit.oldThreshold,
      newThreshold: audit.newThreshold,
      groupPublicKey: audit.newEpochState.groupPublicKey.toString(16),
      groupPublicKeyInvariant: audit.groupPublicKeyInvariant,
      validOldDealers: audit.validOldDealers,
      faultyOldDealers: audit.faultyOldDealers,
      newMemberPublicShares: audit.newEpochState.shares.map((s) => ({
        memberId: s.memberId,
        publicShare: s.publicShare.toString(16),
      })),
      handoverDigest: audit.handoverDigest,
    });
  }
}
