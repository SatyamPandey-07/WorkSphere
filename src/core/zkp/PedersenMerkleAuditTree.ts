/**
 * @file PedersenMerkleAuditTree.ts
 * @description Zero-Knowledge Homomorphic Pedersen-Merkle Liability & Quota Audit Tree.
 * Every leaf commits to a workspace account balance/quota via a hiding Pedersen commitment
 * C = g^v * h^r mod p and SHA-256 hash. Every internal node carries BOTH:
 *   1. The homomorphic product of child commitments: C_parent = C_left * C_right mod p
 *   2. A cryptographic hash binding both children's hashes and commitments.
 * Allows individual accounts to verify inclusion without seeing sibling balances, while
 * proving total system liabilities equal the root commitment with zero-knowledge solvency proofs.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface AuditLeafEntry {
  accountId: string;
  amount: bigint;
}

export interface PedersenMerkleNode {
  level: number;
  index: number;
  hash: string;
  commitment: bigint;
  accountId?: string;
}

export interface MerkleAuditStep {
  direction: 'left' | 'right';
  siblingHash: string;
  siblingCommitment: bigint;
}

export interface AccountInclusionProof {
  accountId: string;
  leafIndex: number;
  amount: bigint;
  blinding: bigint;
  leafCommitment: bigint;
  leafHash: string;
  path: MerkleAuditStep[];
  rootHash: string;
  rootCommitment: bigint;
}

export interface RootSolvencyOpening {
  totalAmount: bigint;
  totalBlinding: bigint;
  rootCommitment: bigint;
  rootHash: string;
  leafCount: number;
  schnorrProof: {
    nonceCommit: bigint;
    challenge: bigint;
    response: bigint;
  };
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

function deriveIndependentGeneratorH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::PedersenMerkleH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
  const raw = BigInt(`0x${digest}`) % (p - 2n) + 2n;
  const h = (raw * raw) % p;
  if (h === 1n || h === g) throw new Error('Degenerate generator H');
  return h;
}

function hashLeaf(accountId: string, commitment: bigint): string {
  return createHash('sha256')
    .update(`WorkSphere::PMLeaf|${accountId}|${commitment.toString(16)}`)
    .digest('hex');
}

function hashInternal(leftHash: string, leftC: bigint, rightHash: string, rightC: bigint): string {
  return createHash('sha256')
    .update(`WorkSphere::PMNode|${leftHash}|${leftC.toString(16)}|${rightHash}|${rightC.toString(16)}`)
    .digest('hex');
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
 * Homomorphic Pedersen-Merkle Tree supporting privacy-preserving inclusion proofs,
 * root total solvency verification, delta audits across epochs, and batch verification.
 */
export class PedersenMerkleAuditTree {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;

  private levels: PedersenMerkleNode[][] = [];
  private leafSecrets: Array<{ accountId: string; amount: bigint; blinding: bigint }> = [];
  private accountIndexMap: Map<string, number> = new Map();

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = deriveIndependentGeneratorH(p, g);
  }

  public commit(amount: bigint, blinding: bigint): bigint {
    return (
      modPow(this.g, modNorm(amount, this.q), this.p) *
      modPow(this.h, modNorm(blinding, this.q), this.p)
    ) % this.p;
  }

  /**
   * Builds a complete padded power-of-two Pedersen-Merkle tree from workspace entries.
   */
  public buildTree(entries: readonly AuditLeafEntry[]): {
    rootHash: string;
    rootCommitment: bigint;
    leafCount: number;
    paddedSize: number;
  } {
    if (entries.length === 0) {
      throw new Error('At least one audit entry is required');
    }

    const seen = new Set<string>();
    for (const e of entries) {
      if (e.amount < 0n) {
        throw new RangeError(`Negative balance not permitted for account ${e.accountId}`);
      }
      if (seen.has(e.accountId)) {
        throw new Error(`Duplicate accountId in audit tree: ${e.accountId}`);
      }
      seen.add(e.accountId);
    }

    let paddedSize = 1;
    while (paddedSize < entries.length) paddedSize <<= 1;

    this.leafSecrets = [];
    this.accountIndexMap.clear();
    const baseLevel: PedersenMerkleNode[] = [];

    for (let i = 0; i < paddedSize; i++) {
      const entry = entries[i] ?? { accountId: `__pad_${i}`, amount: 0n };
      const blinding = randomScalar(this.q);
      const commitment = this.commit(entry.amount, blinding);
      const hash = hashLeaf(entry.accountId, commitment);
      this.leafSecrets.push({ accountId: entry.accountId, amount: entry.amount, blinding });
      if (i < entries.length) {
        this.accountIndexMap.set(entry.accountId, i);
      }
      baseLevel.push({
        level: 0,
        index: i,
        hash,
        commitment,
        accountId: entry.accountId,
      });
    }

    this.levels = [baseLevel];
    let current = baseLevel;
    let levelIdx = 1;

    while (current.length > 1) {
      const next: PedersenMerkleNode[] = [];
      for (let i = 0; i < current.length; i += 2) {
        const left = current[i];
        const right = current[i + 1];
        const commitment = (left.commitment * right.commitment) % this.p;
        const hash = hashInternal(left.hash, left.commitment, right.hash, right.commitment);
        next.push({
          level: levelIdx,
          index: i >> 1,
          hash,
          commitment,
        });
      }
      this.levels.push(next);
      current = next;
      levelIdx++;
    }

    const root = this.getRoot();
    return {
      rootHash: root.hash,
      rootCommitment: root.commitment,
      leafCount: entries.length,
      paddedSize,
    };
  }

  public getRoot(): PedersenMerkleNode {
    if (this.levels.length === 0) {
      throw new Error('Tree has not been built yet');
    }
    return this.levels[this.levels.length - 1][0];
  }

  /**
   * Generates a private inclusion proof for a single account without disclosing sibling amounts.
   */
  public generateInclusionProof(accountId: string): AccountInclusionProof {
    const leafIndex = this.accountIndexMap.get(accountId);
    if (leafIndex === undefined) {
      throw new Error(`Account ${accountId} not found in audit tree`);
    }

    const secret = this.leafSecrets[leafIndex];
    const leafNode = this.levels[0][leafIndex];
    const path: MerkleAuditStep[] = [];

    let idx = leafIndex;
    for (let lvl = 0; lvl < this.levels.length - 1; lvl++) {
      const isRight = (idx & 1) === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      const sibling = this.levels[lvl][siblingIdx];
      path.push({
        direction: isRight ? 'left' : 'right',
        siblingHash: sibling.hash,
        siblingCommitment: sibling.commitment,
      });
      idx >>= 1;
    }

    const root = this.getRoot();
    return {
      accountId,
      leafIndex,
      amount: secret.amount,
      blinding: secret.blinding,
      leafCommitment: leafNode.commitment,
      leafHash: leafNode.hash,
      path,
      rootHash: root.hash,
      rootCommitment: root.commitment,
    };
  }

  /**
   * Verifies BOTH the Pedersen opening of the account's leaf AND every homomorphic sum + hash
   * all the way up to the published root commitment and root hash.
   */
  public verifyInclusionProof(
    proof: AccountInclusionProof,
    expectedRootHash: string,
    expectedRootCommitment: bigint
  ): { valid: boolean; reason?: string } {
    if (proof.amount < 0n) {
      return { valid: false, reason: 'Negative leaf amount is invalid' };
    }
    const recomputedLeafC = this.commit(proof.amount, proof.blinding);
    if (recomputedLeafC !== proof.leafCommitment) {
      return { valid: false, reason: 'Leaf Pedersen commitment opening mismatch' };
    }
    const recomputedLeafH = hashLeaf(proof.accountId, recomputedLeafC);
    if (recomputedLeafH !== proof.leafHash) {
      return { valid: false, reason: 'Leaf hash mismatch' };
    }

    let curHash = recomputedLeafH;
    let curC = recomputedLeafC;

    for (const step of proof.path) {
      if (step.direction === 'left') {
        curHash = hashInternal(step.siblingHash, step.siblingCommitment, curHash, curC);
      } else {
        curHash = hashInternal(curHash, curC, step.siblingHash, step.siblingCommitment);
      }
      curC = (curC * step.siblingCommitment) % this.p;
    }

    if (curHash !== expectedRootHash || proof.rootHash !== expectedRootHash) {
      return { valid: false, reason: 'Reconstructed Merkle root hash mismatch' };
    }
    if (curC !== expectedRootCommitment || proof.rootCommitment !== expectedRootCommitment) {
      return { valid: false, reason: 'Reconstructed homomorphic root commitment mismatch' };
    }

    return { valid: true };
  }

  /**
   * Produces a zero-knowledge Schnorr proof of solvency for the root total liability
   * proving rootCommitment / g^totalAmount == h^totalBlinding without exposing individual leaves.
   */
  public createRootSolvencyProof(auditContext = 'epoch-audit'): RootSolvencyOpening {
    const root = this.getRoot();
    let totalAmount = 0n;
    let totalBlinding = 0n;
    for (const leaf of this.leafSecrets) {
      totalAmount += leaf.amount;
      totalBlinding = modNorm(totalBlinding + leaf.blinding, this.q);
    }

    const k = randomScalar(this.q);
    const nonceCommit = modPow(this.h, k, this.p);
    const challenge = hashScalar('WorkSphere::RootSolvency', [
      auditContext,
      root.hash,
      root.commitment,
      totalAmount,
      nonceCommit,
    ]);
    const response = modNorm(k + challenge * totalBlinding, this.q);

    return {
      totalAmount,
      totalBlinding,
      rootCommitment: root.commitment,
      rootHash: root.hash,
      leafCount: this.accountIndexMap.size,
      schnorrProof: { nonceCommit, challenge, response },
    };
  }

  /**
   * Verifies that the published root commitment opens to the claimed total system liability
   * AND that declared reserves meet or exceed total liabilities.
   */
  public verifyRootSolvency(
    opening: RootSolvencyOpening,
    declaredReserves: bigint,
    auditContext = 'epoch-audit'
  ): { valid: boolean; solvent: boolean; surplus: bigint; reason?: string } {
    const gTotal = modPow(this.g, modNorm(opening.totalAmount, this.q), this.p);
    const blindingCommit = (opening.rootCommitment * modInverse(gTotal, this.p)) % this.p;

    const expectedC = hashScalar('WorkSphere::RootSolvency', [
      auditContext,
      opening.rootHash,
      opening.rootCommitment,
      opening.totalAmount,
      opening.schnorrProof.nonceCommit,
    ]);
    if (expectedC !== opening.schnorrProof.challenge) {
      return { valid: false, solvent: false, surplus: 0n, reason: 'Solvency challenge mismatch' };
    }

    const lhs = modPow(this.h, opening.schnorrProof.response, this.p);
    const rhs = (opening.schnorrProof.nonceCommit * modPow(blindingCommit, expectedC, this.p)) % this.p;
    if (lhs !== rhs) {
      return { valid: false, solvent: false, surplus: 0n, reason: 'Solvency Schnorr proof failed' };
    }

    const surplus = declaredReserves - opening.totalAmount;
    return {
      valid: true,
      solvent: surplus >= 0n,
      surplus,
    };
  }

  /**
   * Batch-verifies multiple account inclusion proofs against a single root snapshot.
   */
  public batchVerifyInclusionProofs(
    proofs: readonly AccountInclusionProof[],
    expectedRootHash: string,
    expectedRootCommitment: bigint
  ): {
    allValid: boolean;
    verifiedAccounts: string[];
    failedAccounts: Array<{ accountId: string; reason: string }>;
    provenSubtotal: bigint;
  } {
    const verifiedAccounts: string[] = [];
    const failedAccounts: Array<{ accountId: string; reason: string }> = [];
    let provenSubtotal = 0n;

    for (const proof of proofs) {
      const res = this.verifyInclusionProof(proof, expectedRootHash, expectedRootCommitment);
      if (res.valid) {
        verifiedAccounts.push(proof.accountId);
        provenSubtotal += proof.amount;
      } else {
        failedAccounts.push({
          accountId: proof.accountId,
          reason: res.reason ?? 'Verification failed',
        });
      }
    }

    return {
      allValid: proofs.length > 0 && failedAccounts.length === 0,
      verifiedAccounts,
      failedAccounts,
      provenSubtotal,
    };
  }

  /**
   * Serializes an AccountInclusionProof into portable JSON format.
   */
  public serializeInclusionProof(proof: AccountInclusionProof): string {
    return JSON.stringify({
      accountId: proof.accountId,
      leafIndex: proof.leafIndex,
      amount: proof.amount.toString(),
      blinding: proof.blinding.toString(16),
      leafCommitment: proof.leafCommitment.toString(16),
      leafHash: proof.leafHash,
      path: proof.path.map((s) => ({
        direction: s.direction,
        siblingHash: s.siblingHash,
        siblingCommitment: s.siblingCommitment.toString(16),
      })),
      rootHash: proof.rootHash,
      rootCommitment: proof.rootCommitment.toString(16),
    });
  }

  /**
   * Deserializes a JSON inclusion proof back into an AccountInclusionProof.
   */
  public deserializeInclusionProof(payload: string): AccountInclusionProof {
    const raw = JSON.parse(payload) as {
      accountId: string;
      leafIndex: number;
      amount: string;
      blinding: string;
      leafCommitment: string;
      leafHash: string;
      path: Array<{ direction: 'left' | 'right'; siblingHash: string; siblingCommitment: string }>;
      rootHash: string;
      rootCommitment: string;
    };

    return {
      accountId: raw.accountId,
      leafIndex: raw.leafIndex,
      amount: BigInt(raw.amount),
      blinding: BigInt(`0x${raw.blinding}`),
      leafCommitment: BigInt(`0x${raw.leafCommitment}`),
      leafHash: raw.leafHash,
      path: raw.path.map((s) => ({
        direction: s.direction,
        siblingHash: s.siblingHash,
        siblingCommitment: BigInt(`0x${s.siblingCommitment}`),
      })),
      rootHash: raw.rootHash,
      rootCommitment: BigInt(`0x${raw.rootCommitment}`),
    };
  }
}
