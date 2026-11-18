/**
 * @file ZeroKnowledgeSecretShareVerification.ts
 * @description Compartmented Dual-Level Hierarchical Verifiable Secret Sharing (HVSS) Engine.
 * Enforces multi-department enterprise secret recovery policies where a master secret S requires:
 *   - Outer Threshold: at least T_outer departments must agree (outer Feldman-VSS sharing of S), AND
 *   - Inner Threshold: inside each participating department d, at least t_d-of-n_d officers must
 *     cooperate to reconstruct department d's outer share (inner Feldman-VSS sharing)!
 * Supports per-officer share auditing, department-level verification, fault-tolerant two-tier
 * reconstruction, and portable JSON policy serialization.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface DepartmentPolicy {
  departmentId: string;
  departmentSlotId: number;
  innerThreshold: number;
  officerIds: number[];
}

export interface OfficerInnerShare {
  departmentId: string;
  officerId: number;
  secretShare: bigint;
  publicShare: bigint;
}

export interface DepartmentShareBundle {
  departmentId: string;
  departmentSlotId: number;
  innerThreshold: number;
  outerPublicShare: bigint;
  innerCommitments: bigint[]; // innerCommitments[0] === outerPublicShare!
  officerShares: OfficerInnerShare[];
}

export interface HierarchicalSecretDeal {
  policyId: string;
  outerThreshold: number;
  masterPublicCommit: bigint;
  outerCommitments: bigint[];
  departments: DepartmentShareBundle[];
  dealDigest: string;
}

export interface HierarchicalRecoveryResult {
  policyId: string;
  recoveredSecret: bigint;
  verifiedAgainstMasterCommit: boolean;
  participatingDepartments: string[];
  rejectedOfficers: Array<{ departmentId: string; officerId: number }>;
  recoveryDigest: string;
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

/**
 * Dual-Level Compartmented Hierarchical Verifiable Secret Sharing (HVSS) Coordinator.
 */
export class ZeroKnowledgeSecretShareVerification {
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

  private evalPoly(coeffs: readonly bigint[], x: bigint): bigint {
    let acc = 0n;
    const xn = modNorm(x, this.q);
    for (let i = coeffs.length - 1; i >= 0; i--) {
      acc = modNorm(acc * xn + coeffs[i], this.q);
    }
    return acc;
  }

  private evalCommitments(commitments: readonly bigint[], x: bigint): bigint {
    const xn = modNorm(x, this.q);
    let acc = 1n;
    let xPow = 1n;
    for (const c of commitments) {
      acc = (acc * modPow(c, xPow, this.p)) % this.p;
      xPow = modNorm(xPow * xn, this.q);
    }
    return acc;
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
   * Deals a compartmented two-tier Feldman-VSS sharing across departments and officers.
   */
  public dealHierarchicalSecret(
    policyId: string,
    masterSecret: bigint,
    outerThreshold: number,
    departments: readonly DepartmentPolicy[]
  ): HierarchicalSecretDeal {
    if (outerThreshold < 1 || outerThreshold > departments.length) {
      throw new RangeError('outerThreshold must lie in [1, departments.length]');
    }

    const slotSet = new Set<number>();
    const deptIdSet = new Set<string>();
    for (const d of departments) {
      if (d.departmentSlotId < 1 || slotSet.has(d.departmentSlotId)) {
        throw new Error(`Invalid or duplicate departmentSlotId: ${d.departmentSlotId}`);
      }
      if (deptIdSet.has(d.departmentId)) {
        throw new Error(`Duplicate departmentId: ${d.departmentId}`);
      }
      if (d.innerThreshold < 1 || d.innerThreshold > d.officerIds.length) {
        throw new RangeError(`Invalid innerThreshold for department ${d.departmentId}`);
      }
      slotSet.add(d.departmentSlotId);
      deptIdSet.add(d.departmentId);
    }

    // Outer polynomial f_outer(0) = masterSecret
    const outerCoeffs: bigint[] = [modNorm(masterSecret, this.q)];
    for (let k = 1; k < outerThreshold; k++) {
      outerCoeffs.push(randomScalar(this.q));
    }
    const outerCommitments = outerCoeffs.map((c) => modPow(this.g, c, this.p));
    const masterPublicCommit = outerCommitments[0];

    // Inner polynomial for each department d: f_d(0) = f_outer(slot_d)
    const bundles: DepartmentShareBundle[] = departments.map((dept) => {
      const deptOuterShare = this.evalPoly(outerCoeffs, BigInt(dept.departmentSlotId));
      const innerCoeffs: bigint[] = [deptOuterShare];
      for (let k = 1; k < dept.innerThreshold; k++) {
        innerCoeffs.push(randomScalar(this.q));
      }
      const innerCommitments = innerCoeffs.map((c) => modPow(this.g, c, this.p));
      const outerPublicShare = innerCommitments[0];

      const officerShares: OfficerInnerShare[] = dept.officerIds.map((officerId) => {
        const secretShare = this.evalPoly(innerCoeffs, BigInt(officerId));
        return {
          departmentId: dept.departmentId,
          officerId,
          secretShare,
          publicShare: modPow(this.g, secretShare, this.p),
        };
      });

      return {
        departmentId: dept.departmentId,
        departmentSlotId: dept.departmentSlotId,
        innerThreshold: dept.innerThreshold,
        outerPublicShare,
        innerCommitments,
        officerShares,
      };
    });

    const dealDigest = createHash('sha256')
      .update(`${policyId}|outerT:${outerThreshold}|depts:${departments.length}|root:${masterPublicCommit.toString(16)}`)
      .digest('hex');

    return {
      policyId,
      outerThreshold,
      masterPublicCommit,
      outerCommitments,
      departments: bundles,
      dealDigest,
    };
  }

  /**
   * Verifies that a department's inner commitment constant term links cleanly to the outer polynomial!
   */
  public verifyDepartmentLinkage(
    bundle: DepartmentShareBundle,
    outerCommitments: readonly bigint[]
  ): boolean {
    if (bundle.innerCommitments.length !== bundle.innerThreshold) return false;
    const expectedOuterPub = this.evalCommitments(outerCommitments, BigInt(bundle.departmentSlotId));
    return bundle.outerPublicShare === expectedOuterPub && bundle.innerCommitments[0] === expectedOuterPub;
  }

  /**
   * Verifies a single officer's inner Feldman share against their department's inner commitments.
   */
  public verifyOfficerShare(
    share: OfficerInnerShare,
    innerCommitments: readonly bigint[]
  ): boolean {
    const lhs = modPow(this.g, modNorm(share.secretShare, this.q), this.p);
    const rhs = this.evalCommitments(innerCommitments, BigInt(share.officerId));
    return lhs === rhs && share.publicShare === rhs;
  }

  /**
   * Audits the entire hierarchical secret deal across all departments and all officers.
   */
  public auditFullDeal(deal: HierarchicalSecretDeal): {
    allValid: boolean;
    invalidDepartments: string[];
    invalidOfficers: Array<{ departmentId: string; officerId: number }>;
  } {
    const invalidDepartments: string[] = [];
    const invalidOfficers: Array<{ departmentId: string; officerId: number }> = [];

    for (const dept of deal.departments) {
      if (!this.verifyDepartmentLinkage(dept, deal.outerCommitments)) {
        invalidDepartments.push(dept.departmentId);
      }
      for (const officer of dept.officerShares) {
        if (!this.verifyOfficerShare(officer, dept.innerCommitments)) {
          invalidOfficers.push({ departmentId: dept.departmentId, officerId: officer.officerId });
        }
      }
    }

    return {
      allValid: invalidDepartments.length === 0 && invalidOfficers.length === 0,
      invalidDepartments,
      invalidOfficers,
    };
  }

  /**
   * Executes fault-tolerant two-tier recovery:
   *   1. For each department submission, filters corrupted officer shares and reconstructs the
   *      department's outer share if >= innerThreshold honest officers participated.
   *   2. If >= outerThreshold departments succeed, reconstructs masterSecret via outer Lagrange
   *      interpolation and verifies g^{masterSecret} == masterPublicCommit!
   */
  public recoverMasterSecret(
    deal: HierarchicalSecretDeal,
    submittedByDept: ReadonlyMap<string, readonly OfficerInnerShare[]>
  ): HierarchicalRecoveryResult {
    const deptMap = new Map(deal.departments.map((d) => [d.departmentId, d]));
    const rejectedOfficers: Array<{ departmentId: string; officerId: number }> = [];
    const recoveredDeptShares: Array<{ departmentId: string; slotId: number; outerShare: bigint }> = [];

    for (const [deptId, submitted] of submittedByDept.entries()) {
      const bundle = deptMap.get(deptId);
      if (!bundle || !this.verifyDepartmentLinkage(bundle, deal.outerCommitments)) continue;

      const seenOfficers = new Set<number>();
      const validOfficers: OfficerInnerShare[] = [];
      for (const sh of submitted) {
        if (
          sh.departmentId !== deptId ||
          seenOfficers.has(sh.officerId) ||
          !this.verifyOfficerShare(sh, bundle.innerCommitments)
        ) {
          rejectedOfficers.push({ departmentId: deptId, officerId: sh.officerId });
          continue;
        }
        seenOfficers.add(sh.officerId);
        validOfficers.push(sh);
      }

      if (validOfficers.length < bundle.innerThreshold) continue;

      const chosen = validOfficers.slice(0, bundle.innerThreshold);
      const ids = chosen.map((o) => o.officerId);
      let outerShare = 0n;
      for (const o of chosen) {
        const lambda = this.lagrangeCoefficient(o.officerId, ids);
        outerShare = modNorm(outerShare + lambda * o.secretShare, this.q);
      }
      if (modPow(this.g, outerShare, this.p) === bundle.outerPublicShare) {
        recoveredDeptShares.push({
          departmentId: deptId,
          slotId: bundle.departmentSlotId,
          outerShare,
        });
      }
    }

    if (recoveredDeptShares.length < deal.outerThreshold) {
      throw new Error(
        `Outer quorum not met: only ${recoveredDeptShares.length} of ${deal.outerThreshold} required departments qualified`
      );
    }

    const chosenDepts = recoveredDeptShares.slice(0, deal.outerThreshold);
    const slotIds = chosenDepts.map((d) => d.slotId);
    let recoveredSecret = 0n;
    for (const d of chosenDepts) {
      const lambda = this.lagrangeCoefficient(d.slotId, slotIds);
      recoveredSecret = modNorm(recoveredSecret + lambda * d.outerShare, this.q);
    }

    const verifiedAgainstMasterCommit = modPow(this.g, recoveredSecret, this.p) === deal.masterPublicCommit;
    const participatingDepartments = chosenDepts.map((d) => d.departmentId);
    const recoveryDigest = createHash('sha256')
      .update(`${deal.policyId}|depts:${participatingDepartments.join(',')}|ok:${verifiedAgainstMasterCommit}`)
      .digest('hex');

    return {
      policyId: deal.policyId,
      recoveredSecret,
      verifiedAgainstMasterCommit,
      participatingDepartments,
      rejectedOfficers,
      recoveryDigest,
    };
  }

  public serializePublicPolicy(deal: HierarchicalSecretDeal): string {
    return JSON.stringify({
      policyId: deal.policyId,
      outerThreshold: deal.outerThreshold,
      masterPublicCommit: deal.masterPublicCommit.toString(16),
      outerCommitments: deal.outerCommitments.map((c) => c.toString(16)),
      departments: deal.departments.map((d) => ({
        departmentId: d.departmentId,
        departmentSlotId: d.departmentSlotId,
        innerThreshold: d.innerThreshold,
        outerPublicShare: d.outerPublicShare.toString(16),
        innerCommitments: d.innerCommitments.map((c) => c.toString(16)),
      })),
      dealDigest: deal.dealDigest,
    });
  }
}
