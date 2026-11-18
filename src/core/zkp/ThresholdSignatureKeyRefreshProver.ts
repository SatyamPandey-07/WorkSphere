/**
 * @file ThresholdSignatureKeyRefreshProver.ts
 * @description Herzberg-Style Proactive Zero-Sum Threshold Signature Key-Refresh & Anti-Drift Prover.
 * Allows an active (t, n) threshold signing committee to refresh all secret shares periodically
 * so stolen old shares become useless against future epochs:
 *   1. Each participating node i generates a degree-(t-1) zero-constant polynomial delta_i(x)
 *      with delta_i(0) = 0 and publishes Feldman commitments C_{i,k} = g^{a_{i,k}} with C_{i,0} == 1.
 *   2. Every node verifies C_{i,0} === 1 (guaranteeing ZERO drift of the master secret) and
 *      verifies received update shares delta_i(j) against C_{i,1..t-1}.
 *   3. Nodes add all verified zero-sum updates to produce fresh epoch shares s'_j = s_j + Sum delta_i(j)
 *      and verify that threshold signatures remain valid under the UNCHANGED group public key.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface RefreshCommitteeShare {
  epoch: number;
  nodeId: number;
  secretShare: bigint;
  publicShare: bigint;
}

export interface RefreshCommitteeState {
  epoch: number;
  threshold: number;
  nodeIds: number[];
  groupPublicKey: bigint;
  shares: RefreshCommitteeShare[];
}

export interface ZeroSumRefreshPackage {
  fromEpoch: number;
  toEpoch: number;
  senderNodeId: number;
  commitments: bigint[]; // commitments[0] MUST equal 1n (g^0)
  deltaShares: Map<number, bigint>;
  freshnessProof: {
    nonceCommit: bigint;
    challenge: bigint;
    response: bigint;
  };
}

export interface KeyRefreshAuditReport {
  fromEpoch: number;
  toEpoch: number;
  acceptedContributors: number[];
  rejectedContributors: number[];
  zeroDriftVerified: boolean;
  groupKeyUnchanged: boolean;
  refreshedState: RefreshCommitteeState;
  auditDigest: string;
}

export interface RefreshVerificationSignature {
  epoch: number;
  message: string;
  R: bigint;
  s: bigint;
  signerIds: number[];
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
 * Proactive Zero-Sum Threshold Signature Key-Refresh Prover & Anti-Drift Auditor.
 */
export class ThresholdSignatureKeyRefreshProver {
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

  public lagrangeCoefficient(nodeId: number, subsetIds: readonly number[]): bigint {
    const xi = BigInt(nodeId);
    let num = 1n;
    let den = 1n;
    for (const other of subsetIds) {
      if (other === nodeId) continue;
      const xj = BigInt(other);
      num = modNorm(num * xj, this.q);
      den = modNorm(den * modNorm(xj - xi, this.q), this.q);
    }
    return modNorm(num * modInverse(den, this.q), this.q);
  }

  /**
   * Initializes Epoch 1 threshold signing committee shares.
   */
  public initCommittee(threshold: number, nodeIds: readonly number[]): RefreshCommitteeState {
    if (threshold < 2 || threshold > nodeIds.length) {
      throw new RangeError('Zero-sum proactive refresh requires 2 <= threshold <= nodeIds.length');
    }

    const coeffs: bigint[] = [];
    for (let k = 0; k < threshold; k++) {
      coeffs.push(randomScalar(this.q));
    }
    const groupPublicKey = modPow(this.g, coeffs[0], this.p);

    const shares: RefreshCommitteeShare[] = nodeIds.map((nodeId) => {
      const x = BigInt(nodeId);
      let s = 0n;
      let xPow = 1n;
      for (const c of coeffs) {
        s = modNorm(s + c * xPow, this.q);
        xPow = modNorm(xPow * x, this.q);
      }
      return {
        epoch: 1,
        nodeId,
        secretShare: s,
        publicShare: modPow(this.g, s, this.p),
      };
    });

    return {
      epoch: 1,
      threshold,
      nodeIds: [...nodeIds],
      groupPublicKey,
      shares,
    };
  }

  /**
   * Generates a node's zero-constant-term refresh polynomial delta_i(x) = a_1*x + ... + a_{t-1}*x^{t-1}
   * with a Schnorr proof-of-freshness on the leading coefficient a_1.
   */
  public createZeroSumRefreshPackage(
    state: RefreshCommitteeState,
    senderNodeId: number
  ): ZeroSumRefreshPackage {
    if (!state.nodeIds.includes(senderNodeId)) {
      throw new Error(`Node ${senderNodeId} is not part of active committee`);
    }

    const coeffs: bigint[] = [0n]; // Constant term MUST be strictly 0
    for (let k = 1; k < state.threshold; k++) {
      coeffs.push(randomScalar(this.q));
    }

    const commitments = coeffs.map((c) => modPow(this.g, c, this.p)); // commitments[0] === 1n
    const deltaShares = new Map<number, bigint>();

    for (const targetId of state.nodeIds) {
      const x = BigInt(targetId);
      let val = 0n;
      let xPow = 1n;
      for (const c of coeffs) {
        val = modNorm(val + c * xPow, this.q);
        xPow = modNorm(xPow * x, this.q);
      }
      deltaShares.set(targetId, val);
    }

    // Proof of knowledge of non-trivial linear term coeffs[1]
    const k = randomScalar(this.q);
    const nonceCommit = modPow(this.g, k, this.p);
    const challenge = hashScalar('WorkSphere::ZeroSumFreshness', [
      BigInt(state.epoch),
      BigInt(state.epoch + 1),
      BigInt(senderNodeId),
      commitments[1],
      nonceCommit,
    ]);
    const response = modNorm(k + challenge * coeffs[1], this.q);

    return {
      fromEpoch: state.epoch,
      toEpoch: state.epoch + 1,
      senderNodeId,
      commitments,
      deltaShares,
      freshnessProof: { nonceCommit, challenge, response },
    };
  }

  /**
   * Audits a zero-sum refresh package: strictly rejects non-zero constant terms (anti-drift)
   * and verifies every node's delta share against the broadcasted Feldman commitments.
   */
  public verifyZeroSumPackage(
    pkg: ZeroSumRefreshPackage,
    state: RefreshCommitteeState
  ): { valid: boolean; reason?: string } {
    if (pkg.fromEpoch !== state.epoch || pkg.toEpoch !== state.epoch + 1) {
      return { valid: false, reason: 'Epoch transition mismatch' };
    }
    if (pkg.commitments.length !== state.threshold) {
      return { valid: false, reason: 'Commitment degree does not match threshold' };
    }
    // CRITICAL ANTI-DRIFT INVARIANT: g^{a_0} MUST equal 1n!
    if (pkg.commitments[0] !== 1n) {
      return { valid: false, reason: 'Non-zero constant term detected (key drift attack blocked)' };
    }
    if (pkg.commitments[1] === 1n) {
      return { valid: false, reason: 'Trivial zero linear coefficient provides no refresh entropy' };
    }

    const fp = pkg.freshnessProof;
    const expectedC = hashScalar('WorkSphere::ZeroSumFreshness', [
      BigInt(pkg.fromEpoch),
      BigInt(pkg.toEpoch),
      BigInt(pkg.senderNodeId),
      pkg.commitments[1],
      fp.nonceCommit,
    ]);
    if (expectedC !== fp.challenge) {
      return { valid: false, reason: 'Freshness proof challenge mismatch' };
    }
    const lhsF = modPow(this.g, fp.response, this.p);
    const rhsF = (fp.nonceCommit * modPow(pkg.commitments[1], fp.challenge, this.p)) % this.p;
    if (lhsF !== rhsF) {
      return { valid: false, reason: 'Freshness Schnorr proof failed' };
    }

    for (const targetId of state.nodeIds) {
      const share = pkg.deltaShares.get(targetId);
      if (share === undefined) {
        return { valid: false, reason: `Missing delta share for node ${targetId}` };
      }
      const lhs = modPow(this.g, modNorm(share, this.q), this.p);
      const x = BigInt(targetId);
      let rhs = 1n;
      let xPow = 1n;
      for (const comm of pkg.commitments) {
        rhs = (rhs * modPow(comm, xPow, this.p)) % this.p;
        xPow = modNorm(xPow * x, this.q);
      }
      if (lhs !== rhs) {
        return { valid: false, reason: `Feldman verification failed for node ${targetId}` };
      }
    }

    return { valid: true };
  }

  /**
   * Executes a proactive refresh epoch across submitted packages, rejecting any drifting or
   * malformed packages and confirming that the master groupPublicKey stays strictly invariant.
   */
  public applyProactiveRefresh(
    state: RefreshCommitteeState,
    packages: readonly ZeroSumRefreshPackage[],
    minContributors = 1
  ): KeyRefreshAuditReport {
    const accepted: ZeroSumRefreshPackage[] = [];
    const acceptedContributors: number[] = [];
    const rejectedContributors: number[] = [];
    const seen = new Set<number>();

    for (const pkg of packages) {
      if (seen.has(pkg.senderNodeId)) {
        rejectedContributors.push(pkg.senderNodeId);
        continue;
      }
      seen.add(pkg.senderNodeId);
      const check = this.verifyZeroSumPackage(pkg, state);
      if (check.valid) {
        accepted.push(pkg);
        acceptedContributors.push(pkg.senderNodeId);
      } else {
        rejectedContributors.push(pkg.senderNodeId);
      }
    }

    if (accepted.length < minContributors) {
      throw new Error(
        `Insufficient valid refresh contributors: got ${accepted.length}, need ${minContributors}`
      );
    }

    const toEpoch = state.epoch + 1;
    const refreshedShares: RefreshCommitteeShare[] = state.shares.map((oldShare) => {
      let deltaSum = 0n;
      for (const pkg of accepted) {
        deltaSum = modNorm(deltaSum + (pkg.deltaShares.get(oldShare.nodeId) ?? 0n), this.q);
      }
      const newSecret = modNorm(oldShare.secretShare + deltaSum, this.q);
      return {
        epoch: toEpoch,
        nodeId: oldShare.nodeId,
        secretShare: newSecret,
        publicShare: modPow(this.g, newSecret, this.p),
      };
    });

    const refreshedState: RefreshCommitteeState = {
      epoch: toEpoch,
      threshold: state.threshold,
      nodeIds: [...state.nodeIds],
      groupPublicKey: state.groupPublicKey,
      shares: refreshedShares,
    };

    const groupKeyUnchanged = this.verifyGroupKeyInvariance(
      refreshedState,
      state.nodeIds.slice(0, state.threshold)
    );
    const zeroDriftVerified = accepted.every((p) => p.commitments[0] === 1n);

    const auditDigest = createHash('sha256')
      .update(
        `WorkSphere::KeyRefresh|${state.epoch}->${toEpoch}|acc:${acceptedContributors.join(',')}|rej:${rejectedContributors.join(',')}|gpk:${state.groupPublicKey.toString(16)}`
      )
      .digest('hex');

    return {
      fromEpoch: state.epoch,
      toEpoch,
      acceptedContributors,
      rejectedContributors,
      zeroDriftVerified,
      groupKeyUnchanged,
      refreshedState,
      auditDigest,
    };
  }

  public verifyGroupKeyInvariance(
    state: RefreshCommitteeState,
    subsetIds: readonly number[]
  ): boolean {
    if (subsetIds.length < state.threshold) return false;
    const shareMap = new Map(state.shares.map((s) => [s.nodeId, s]));
    let acc = 1n;
    for (const id of subsetIds) {
      const sh = shareMap.get(id);
      if (!sh) return false;
      const lambda = this.lagrangeCoefficient(id, subsetIds);
      acc = (acc * modPow(sh.publicShare, lambda, this.p)) % this.p;
    }
    return acc === state.groupPublicKey;
  }

  /**
   * Produces a Schnorr threshold signature using any t refreshed shares to prove operational
   * signing continuity under the invariant group public key.
   */
  public signWithEpochShares(
    state: RefreshCommitteeState,
    signerNodeIds: readonly number[],
    message: string
  ): RefreshVerificationSignature {
    if (signerNodeIds.length !== state.threshold) {
      throw new Error(`Expected exactly ${state.threshold} signers`);
    }
    const shareMap = new Map(state.shares.map((s) => [s.nodeId, s]));
    const nonces = new Map<number, bigint>();
    let combinedR = 1n;

    for (const id of signerNodeIds) {
      const k = randomScalar(this.q);
      nonces.set(id, k);
      combinedR = (combinedR * modPow(this.g, k, this.p)) % this.p;
    }

    const e = hashScalar('WorkSphere::RefreshedSchnorrSig', [
      state.groupPublicKey,
      combinedR,
      message,
    ]);

    let s = 0n;
    for (const id of signerNodeIds) {
      const sh = shareMap.get(id);
      if (!sh) throw new Error(`Unknown signer node ${id}`);
      const lambda = this.lagrangeCoefficient(id, signerNodeIds);
      const k = nonces.get(id)!;
      const partial = modNorm(k + e * modNorm(lambda * sh.secretShare, this.q), this.q);
      s = modNorm(s + partial, this.q);
    }

    return {
      epoch: state.epoch,
      message,
      R: combinedR,
      s,
      signerIds: [...signerNodeIds],
    };
  }

  public verifyEpochSignature(groupPublicKey: bigint, sig: RefreshVerificationSignature): boolean {
    const e = hashScalar('WorkSphere::RefreshedSchnorrSig', [
      groupPublicKey,
      sig.R,
      sig.message,
    ]);
    const lhs = modPow(this.g, modNorm(sig.s, this.q), this.p);
    const rhs = (sig.R * modPow(groupPublicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  public serializeAuditReport(report: KeyRefreshAuditReport): string {
    return JSON.stringify({
      fromEpoch: report.fromEpoch,
      toEpoch: report.toEpoch,
      acceptedContributors: report.acceptedContributors,
      rejectedContributors: report.rejectedContributors,
      zeroDriftVerified: report.zeroDriftVerified,
      groupKeyUnchanged: report.groupKeyUnchanged,
      groupPublicKey: report.refreshedState.groupPublicKey.toString(16),
      auditDigest: report.auditDigest,
    });
  }
}
