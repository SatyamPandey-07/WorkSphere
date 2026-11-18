import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Multi-Tier Role-Based Threshold Quorum Proof Prover.
 *
 * Implements composite multi-tier organizational governance approval proofs:
 *  - Members hold Schnorr signing keys and belong to named roles (e.g., 'exec', 'security', 'audit')
 *    with per-member voting weight.
 *  - A QuorumPolicy specifies conjunctive AND-rules across multiple role tiers
 *    (e.g., >= 2 'security' signers with weight >= 20 AND >= 1 'exec' signer AND total weight >= 60).
 *  - Aggregates individual Schnorr approvals into a single verifiable QuorumProofBundle,
 *    automatically isolating invalid/forged/duplicate signatures and certifying policy satisfaction!
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

export interface GovernanceMemberPublic {
  memberId: string;
  role: string;
  weight: bigint;
  publicKey: bigint;
}

export interface GovernanceMemberSigner extends GovernanceMemberPublic {
  secretKey: bigint;
}

export interface RoleTierRequirement {
  role: string;
  minSigners: number;
  minWeight: bigint;
}

export interface MultiTierQuorumPolicy {
  policyId: string;
  minTotalWeight: bigint;
  minTotalSigners: number;
  tierRequirements: RoleTierRequirement[];
}

export interface MemberProposalApproval {
  proposalId: string;
  memberId: string;
  role: string;
  decision: 'APPROVE' | 'REJECT';
  sigR: bigint;
  sigS: bigint;
}

export interface QuorumProofBundle {
  policyId: string;
  proposalId: string;
  proposalDigest: string;
  approvals: MemberProposalApproval[];
  totalApprovedWeight: bigint;
  roleSummaries: Record<string, { signers: number; weight: string }>;
  bundleDigest: string;
}

export class VerifiableThresholdQuorumProofProver {
  private registry = new Map<string, GovernanceMemberPublic>();

  public registerMember(memberId: string, role: string, weight: bigint): GovernanceMemberSigner {
    if (this.registry.has(memberId)) throw new Error(`Member "${memberId}" already registered`);
    if (weight <= 0n) throw new RangeError('Member weight must be positive');
    const secretKey = randomScalar();
    const publicKey = modPow(BASE_G, secretKey, SAFE_PRIME_P);
    const pub: GovernanceMemberPublic = { memberId, role, weight, publicKey };
    this.registry.set(memberId, pub);
    return { ...pub, secretKey };
  }

  public computeProposalDigest(policyId: string, proposalId: string, payload: string): string {
    return sha256Hex('GOV-PROPOSAL-V1', policyId, proposalId, payload);
  }

  public signApproval(
    signer: GovernanceMemberSigner,
    policyId: string,
    proposalId: string,
    proposalDigest: string,
    decision: 'APPROVE' | 'REJECT' = 'APPROVE',
  ): MemberProposalApproval {
    const msg = sha256Hex('GOV-VOTE-V1', policyId, proposalId, proposalDigest, signer.memberId, signer.role, decision);
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('GOV-SCHNORR-V1', sigR.toString(16), signer.publicKey.toString(16), msg);
    const sigS = modScalar(k + c * signer.secretKey);
    return { proposalId, memberId: signer.memberId, role: signer.role, decision, sigR, sigS };
  }

  public verifyApproval(policyId: string, proposalDigest: string, app: MemberProposalApproval): boolean {
    const rec = this.registry.get(app.memberId);
    if (!rec || rec.role !== app.role) return false;
    const msg = sha256Hex('GOV-VOTE-V1', policyId, app.proposalId, proposalDigest, app.memberId, app.role, app.decision);
    const c = hashToScalar('GOV-SCHNORR-V1', app.sigR.toString(16), rec.publicKey.toString(16), msg);
    return modPow(BASE_G, app.sigS, SAFE_PRIME_P) === (app.sigR * modPow(rec.publicKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private computeBundleDigest(
    policyId: string,
    proposalId: string,
    proposalDigest: string,
    approvals: MemberProposalApproval[],
  ): string {
    const canonical = approvals
      .map((a) => `${a.memberId}:${a.role}:${a.sigR.toString(16)}:${a.sigS.toString(16)}`)
      .sort();
    return sha256Hex('GOV-BUNDLE-V1', policyId, proposalId, proposalDigest, ...canonical);
  }

  private evaluatePolicy(
    policy: MultiTierQuorumPolicy,
    validApprovals: MemberProposalApproval[],
  ): {
    satisfied: boolean;
    totalWeight: bigint;
    roleSummaries: Record<string, { signers: number; weight: string }>;
    unmetTiers: string[];
  } {
    let totalWeight = 0n;
    const roleCounts = new Map<string, number>();
    const roleWeights = new Map<string, bigint>();

    for (const a of validApprovals) {
      const rec = this.registry.get(a.memberId)!;
      totalWeight += rec.weight;
      roleCounts.set(rec.role, (roleCounts.get(rec.role) ?? 0) + 1);
      roleWeights.set(rec.role, (roleWeights.get(rec.role) ?? 0n) + rec.weight);
    }

    const unmetTiers: string[] = [];
    if (validApprovals.length < policy.minTotalSigners) unmetTiers.push('TOTAL_SIGNERS');
    if (totalWeight < policy.minTotalWeight) unmetTiers.push('TOTAL_WEIGHT');

    for (const req of policy.tierRequirements) {
      const cnt = roleCounts.get(req.role) ?? 0;
      const wt = roleWeights.get(req.role) ?? 0n;
      if (cnt < req.minSigners || wt < req.minWeight) {
        unmetTiers.push(`ROLE:${req.role}`);
      }
    }

    const roleSummaries: Record<string, { signers: number; weight: string }> = {};
    for (const [role, cnt] of roleCounts.entries()) {
      roleSummaries[role] = { signers: cnt, weight: (roleWeights.get(role) ?? 0n).toString() };
    }

    return { satisfied: unmetTiers.length === 0, totalWeight, roleSummaries, unmetTiers };
  }

  public assembleQuorumProof(
    policy: MultiTierQuorumPolicy,
    proposalId: string,
    proposalDigest: string,
    submissions: MemberProposalApproval[],
  ): {
    bundle: QuorumProofBundle | null;
    rejectedMemberIds: string[];
    unmetTiers: string[];
  } {
    const seen = new Set<string>();
    const validApprovals: MemberProposalApproval[] = [];
    const rejectedMemberIds: string[] = [];

    for (const sub of submissions) {
      if (
        sub.proposalId !== proposalId ||
        sub.decision !== 'APPROVE' ||
        seen.has(sub.memberId) ||
        !this.verifyApproval(policy.policyId, proposalDigest, sub)
      ) {
        rejectedMemberIds.push(sub.memberId);
        continue;
      }
      seen.add(sub.memberId);
      validApprovals.push(sub);
    }

    const evalRes = this.evaluatePolicy(policy, validApprovals);
    if (!evalRes.satisfied) {
      return { bundle: null, rejectedMemberIds, unmetTiers: evalRes.unmetTiers };
    }

    const bundleDigest = this.computeBundleDigest(policy.policyId, proposalId, proposalDigest, validApprovals);
    return {
      bundle: {
        policyId: policy.policyId,
        proposalId,
        proposalDigest,
        approvals: validApprovals,
        totalApprovedWeight: evalRes.totalWeight,
        roleSummaries: evalRes.roleSummaries,
        bundleDigest,
      },
      rejectedMemberIds,
      unmetTiers: [],
    };
  }

  public verifyQuorumProof(policy: MultiTierQuorumPolicy, bundle: QuorumProofBundle): boolean {
    if (bundle.policyId !== policy.policyId) return false;
    if (this.computeBundleDigest(bundle.policyId, bundle.proposalId, bundle.proposalDigest, bundle.approvals) !== bundle.bundleDigest) {
      return false;
    }

    const seen = new Set<string>();
    for (const app of bundle.approvals) {
      if (app.proposalId !== bundle.proposalId || app.decision !== 'APPROVE' || seen.has(app.memberId)) {
        return false;
      }
      if (!this.verifyApproval(policy.policyId, bundle.proposalDigest, app)) return false;
      seen.add(app.memberId);
    }

    const evalRes = this.evaluatePolicy(policy, bundle.approvals);
    return evalRes.satisfied && evalRes.totalWeight === bundle.totalApprovedWeight;
  }

  public serializeBundle(bundle: QuorumProofBundle): string {
    return JSON.stringify({
      policyId: bundle.policyId,
      proposalId: bundle.proposalId,
      totalApprovedWeight: bundle.totalApprovedWeight.toString(),
      roleSummaries: bundle.roleSummaries,
      bundleDigest: bundle.bundleDigest,
    });
  }
}
