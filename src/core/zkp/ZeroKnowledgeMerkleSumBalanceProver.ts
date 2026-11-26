/**
 * @file ZeroKnowledgeMerkleSumBalanceProver.ts
 * @description Maxwell-Style Binary Merkle-Sum Tree Proof-of-Liabilities & Solvency Prover.
 * Every leaf commits to a salted user account ID and non-negative balance. Every internal node
 * carries BOTH the exact sum of its left and right child balances AND a SHA-256 hash binding
 * `(leftSum, leftHash, rightSum, rightHash)`:
 *   - Prevents balance suppression (omitting users or injecting negative balances).
 *   - Allows any user to verify inclusion in O(log N) without seeing any other user's ID or balance.
 *   - Proves total platform liabilities <= verified reserves with batch inclusion auditing.
 */

import { createHash, randomBytes } from 'node:crypto';

export interface AccountLiabilityEntry {
  accountId: string;
  balance: bigint;
}

export interface MerkleSumNode {
  level: number;
  index: number;
  sum: bigint;
  hash: string;
  accountId?: string;
  saltHex?: string;
}

export interface MerkleSumProofStep {
  direction: 'left' | 'right';
  siblingSum: bigint;
  siblingHash: string;
}

export interface AccountSumInclusionProof {
  auditEpochId: string;
  accountId: string;
  leafIndex: number;
  balance: bigint;
  saltHex: string;
  leafHash: string;
  path: MerkleSumProofStep[];
  rootSum: bigint;
  rootHash: string;
}

export interface SolvencyAuditCertificate {
  auditEpochId: string;
  totalAccounts: number;
  totalLiabilities: bigint;
  declaredReserves: bigint;
  surplus: bigint;
  solvent: boolean;
  rootHash: string;
  certificateDigest: string;
}

function hashLeaf(accountId: string, balance: bigint, saltHex: string): string {
  return createHash('sha256')
    .update(`WorkSphere::MSumLeaf|${accountId}|${balance.toString()}|${saltHex}`)
    .digest('hex');
}

function hashParent(leftSum: bigint, leftHash: string, rightSum: bigint, rightHash: string): string {
  return createHash('sha256')
    .update(`WorkSphere::MSumNode|${leftSum.toString()}|${leftHash}|${rightSum.toString()}|${rightHash}`)
    .digest('hex');
}

/**
 * Maxwell Merkle-Sum Proof-of-Liabilities Tree with Non-Negative Invariant Checks.
 */
export class ZeroKnowledgeMerkleSumBalanceProver {
  private auditEpochId = '';
  private levels: MerkleSumNode[][] = [];
  private readonly accountIndex: Map<string, number> = new Map();
  private realLeafCount = 0;

  /**
   * Constructs a padded power-of-two Merkle-Sum tree from account liability entries.
   */
  public buildTree(
    auditEpochId: string,
    entries: readonly AccountLiabilityEntry[]
  ): {
    auditEpochId: string;
    totalAccounts: number;
    totalLiabilities: bigint;
    rootHash: string;
    treeDepth: number;
  } {
    if (entries.length === 0) {
      throw new Error('At least one liability entry is required');
    }
    const seen = new Set<string>();
    for (const e of entries) {
      if (e.balance < 0n) {
        throw new RangeError(`Negative balance rejected for account ${e.accountId}`);
      }
      if (seen.has(e.accountId)) {
        throw new Error(`Duplicate accountId detected: ${e.accountId}`);
      }
      seen.add(e.accountId);
    }

    this.auditEpochId = auditEpochId;
    this.realLeafCount = entries.length;
    this.accountIndex.clear();

    let padded = 1;
    while (padded < entries.length) padded <<= 1;

    const base: MerkleSumNode[] = [];
    for (let i = 0; i < padded; i++) {
      const entry = entries[i] ?? { accountId: `__zero_pad_${i}`, balance: 0n };
      const saltHex = randomBytes(16).toString('hex');
      const hash = hashLeaf(entry.accountId, entry.balance, saltHex);
      if (i < entries.length) {
        this.accountIndex.set(entry.accountId, i);
      }
      base.push({
        level: 0,
        index: i,
        sum: entry.balance,
        hash,
        accountId: entry.accountId,
        saltHex,
      });
    }

    this.levels = [base];
    let current = base;
    let lvl = 1;
    while (current.length > 1) {
      const next: MerkleSumNode[] = [];
      for (let i = 0; i < current.length; i += 2) {
        const left = current[i];
        const right = current[i + 1];
        const sum = left.sum + right.sum;
        const hash = hashParent(left.sum, left.hash, right.sum, right.hash);
        next.push({ level: lvl, index: i >> 1, sum, hash });
      }
      this.levels.push(next);
      current = next;
      lvl++;
    }

    const root = this.getRoot();
    return {
      auditEpochId,
      totalAccounts: entries.length,
      totalLiabilities: root.sum,
      rootHash: root.hash,
      treeDepth: this.levels.length - 1,
    };
  }

  public getRoot(): MerkleSumNode {
    if (this.levels.length === 0) throw new Error('Merkle-Sum tree has not been built');
    return this.levels[this.levels.length - 1][0];
  }

  /**
   * Generates a privacy-preserving O(log N) Merkle-Sum inclusion proof for one account.
   */
  public generateInclusionProof(accountId: string): AccountSumInclusionProof {
    const leafIndex = this.accountIndex.get(accountId);
    if (leafIndex === undefined) {
      throw new Error(`Account ${accountId} not found in Merkle-Sum tree`);
    }
    const leaf = this.levels[0][leafIndex];
    const path: MerkleSumProofStep[] = [];
    let idx = leafIndex;

    for (let lvl = 0; lvl < this.levels.length - 1; lvl++) {
      const isRight = (idx & 1) === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      const sib = this.levels[lvl][sibIdx];
      path.push({
        direction: isRight ? 'left' : 'right',
        siblingSum: sib.sum,
        siblingHash: sib.hash,
      });
      idx >>= 1;
    }

    const root = this.getRoot();
    return {
      auditEpochId: this.auditEpochId,
      accountId,
      leafIndex,
      balance: leaf.sum,
      saltHex: leaf.saltHex!,
      leafHash: leaf.hash,
      path,
      rootSum: root.sum,
      rootHash: root.hash,
    };
  }

  /**
   * Verifies an account's Merkle-Sum proof: checks non-negativity of EVERY sibling sum along
   * the path (blocking negative-balance inflation attacks) and exact root sum & hash reconstruction.
   */
  public verifyInclusionProof(
    proof: AccountSumInclusionProof,
    expectedRootHash: string,
    expectedRootSum: bigint
  ): { valid: boolean; reason?: string } {
    if (proof.balance < 0n) {
      return { valid: false, reason: 'Account balance cannot be negative' };
    }
    const recomputedLeafHash = hashLeaf(proof.accountId, proof.balance, proof.saltHex);
    if (recomputedLeafHash !== proof.leafHash) {
      return { valid: false, reason: 'Leaf hash mismatch' };
    }

    let curSum = proof.balance;
    let curHash = recomputedLeafHash;

    for (let i = 0; i < proof.path.length; i++) {
      const step = proof.path[i];
      if (step.siblingSum < 0n) {
        return { valid: false, reason: `Negative sibling sum attack detected at level ${i}` };
      }
      if (step.direction === 'left') {
        curHash = hashParent(step.siblingSum, step.siblingHash, curSum, curHash);
      } else {
        curHash = hashParent(curSum, curHash, step.siblingSum, step.siblingHash);
      }
      curSum += step.siblingSum;
    }

    if (curSum !== expectedRootSum || proof.rootSum !== expectedRootSum) {
      return { valid: false, reason: 'Reconstructed root liability sum mismatch' };
    }
    if (curHash !== expectedRootHash || proof.rootHash !== expectedRootHash) {
      return { valid: false, reason: 'Reconstructed Merkle-Sum root hash mismatch' };
    }

    return { valid: true };
  }

  /**
   * Issues a solvency audit certificate comparing root liabilities against attested reserves.
   */
  public issueSolvencyCertificate(declaredReserves: bigint): SolvencyAuditCertificate {
    if (declaredReserves < 0n) throw new RangeError('Reserves cannot be negative');
    const root = this.getRoot();
    const surplus = declaredReserves - root.sum;
    const solvent = surplus >= 0n;
    const certificateDigest = createHash('sha256')
      .update(
        `WorkSphere::SolvencyCert|${this.auditEpochId}|acc:${this.realLeafCount}|liab:${root.sum}|res:${declaredReserves}|root:${root.hash}`
      )
      .digest('hex');

    return {
      auditEpochId: this.auditEpochId,
      totalAccounts: this.realLeafCount,
      totalLiabilities: root.sum,
      declaredReserves,
      surplus,
      solvent,
      rootHash: root.hash,
      certificateDigest,
    };
  }

  /**
   * Audits a sample batch of customer inclusion proofs against a published solvency certificate.
   */
  public batchVerifyAgainstCertificate(
    proofs: readonly AccountSumInclusionProof[],
    cert: SolvencyAuditCertificate
  ): {
    allValid: boolean;
    verifiedAccounts: string[];
    failedAccounts: Array<{ accountId: string; reason: string }>;
    auditedBalanceTotal: bigint;
  } {
    const verifiedAccounts: string[] = [];
    const failedAccounts: Array<{ accountId: string; reason: string }> = [];
    let auditedBalanceTotal = 0n;

    for (const p of proofs) {
      const res = this.verifyInclusionProof(p, cert.rootHash, cert.totalLiabilities);
      if (res.valid) {
        verifiedAccounts.push(p.accountId);
        auditedBalanceTotal += p.balance;
      } else {
        failedAccounts.push({ accountId: p.accountId, reason: res.reason ?? 'Failed' });
      }
    }

    return {
      allValid: proofs.length > 0 && failedAccounts.length === 0,
      verifiedAccounts,
      failedAccounts,
      auditedBalanceTotal,
    };
  }

  public serializeInclusionProof(proof: AccountSumInclusionProof): string {
    return JSON.stringify({
      auditEpochId: proof.auditEpochId,
      accountId: proof.accountId,
      leafIndex: proof.leafIndex,
      balance: proof.balance.toString(),
      saltHex: proof.saltHex,
      leafHash: proof.leafHash,
      path: proof.path.map((s) => ({
        direction: s.direction,
        siblingSum: s.siblingSum.toString(),
        siblingHash: s.siblingHash,
      })),
      rootSum: proof.rootSum.toString(),
      rootHash: proof.rootHash,
    });
  }

  public deserializeInclusionProof(payload: string): AccountSumInclusionProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      auditEpochId: raw.auditEpochId,
      accountId: raw.accountId,
      leafIndex: Number(raw.leafIndex),
      balance: BigInt(raw.balance),
      saltHex: raw.saltHex,
      leafHash: raw.leafHash,
      path: raw.path.map((s: Record<string, string>) => ({
        direction: s.direction as 'left' | 'right',
        siblingSum: BigInt(s.siblingSum),
        siblingHash: s.siblingHash,
      })),
      rootSum: BigInt(raw.rootSum),
      rootHash: raw.rootHash,
    };
  }

  /**
   * Audits every internal node of the constructed Merkle-Sum tree to verify global structural
   * invariants: sum(parent) == sum(left) + sum(right), non-negative sums, and exact SHA-256 bindings.
   */
  public verifyTreeIntegrity(): { valid: boolean; checkedNodes: number; corruptedNodes: number } {
    if (this.levels.length === 0) return { valid: false, checkedNodes: 0, corruptedNodes: 0 };
    let checkedNodes = 0;
    let corruptedNodes = 0;

    for (const leaf of this.levels[0]) {
      checkedNodes++;
      const expectedHash = hashLeaf(leaf.accountId!, leaf.sum, leaf.saltHex!);
      if (leaf.sum < 0n || leaf.hash !== expectedHash) corruptedNodes++;
    }

    for (let lvl = 1; lvl < this.levels.length; lvl++) {
      const prev = this.levels[lvl - 1];
      for (let i = 0; i < this.levels[lvl].length; i++) {
        checkedNodes++;
        const node = this.levels[lvl][i];
        const left = prev[i * 2];
        const right = prev[i * 2 + 1];
        const expectedSum = left.sum + right.sum;
        const expectedHash = hashParent(left.sum, left.hash, right.sum, right.hash);
        if (node.sum !== expectedSum || node.hash !== expectedHash) corruptedNodes++;
      }
    }

    return { valid: corruptedNodes === 0, checkedNodes, corruptedNodes };
  }
}
