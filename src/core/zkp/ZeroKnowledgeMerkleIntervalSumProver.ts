import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Merkle Interval Sum Prover.
 *
 * Builds a segment-sum Merkle tree where each leaf stores a Pedersen commitment
 * C_i = g^{v_i} * h^{r_i} mod P and each internal node stores:
 *  - homomorphic sum commitment: C_parent = C_left * C_right mod P
 *  - domain-separated SHA-256 integrity hash binding [start, end, C_parent, H_left, H_right]
 *
 * Enables O(log N) verifiable range-sum proofs over any sub-interval [L, R]
 * together with a zero-knowledge Schnorr opening proof of the aggregate interval sum
 * (or excess above a threshold) without disclosing individual leaf values.
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

function deriveGeneratorH(): bigint {
  const raw = BigInt('0x' + sha256Hex('ZK-MERKLE-INTERVAL-SUM-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n) + 2n;
  const cand = (raw * raw) % SAFE_PRIME_P;
  return cand === 1n || cand === BASE_G ? 9n : cand;
}

export const BASE_H = deriveGeneratorH();

export interface IntervalLeafSecret {
  index: number;
  label: string;
  value: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface IntervalTreeNode {
  start: number;
  end: number;
  commitment: bigint;
  hash: string;
  left?: IntervalTreeNode;
  right?: IntervalTreeNode;
}

export interface CoveredSubtreeProof {
  start: number;
  end: number;
  commitment: bigint;
  nodeHash: string;
  siblings: Array<{ direction: 'left' | 'right'; siblingHash: string; siblingCommitment: bigint; siblingStart: number; siblingEnd: number }>;
}

export interface IntervalSumOpeningProof {
  intervalStart: number;
  intervalEnd: number;
  claimedSum: bigint;
  aggregateCommitment: bigint;
  rootHash: string;
  rootCommitment: bigint;
  coveredSubtrees: CoveredSubtreeProof[];
  announcementR: bigint;
  challenge: bigint;
  responseBlinding: bigint;
  domainContext: string;
}

export interface IntervalTreeAuditReport {
  leafCount: number;
  rootHash: string;
  rootCommitment: bigint;
  totalValue: bigint;
  verifiedIntervalProofs: number;
}

export class ZeroKnowledgeMerkleIntervalSumProver {
  private leaves: IntervalLeafSecret[] = [];
  private root: IntervalTreeNode | null = null;

  public commitValue(value: bigint, blinding?: bigint): { commitment: bigint; blinding: bigint } {
    if (value < 0n || value >= SUBGROUP_Q) {
      throw new RangeError('Leaf value must be in [0, Q)');
    }
    const r = blinding !== undefined ? modScalar(blinding) : randomScalar();
    const commitment = (modPow(BASE_G, value, SAFE_PRIME_P) * modPow(BASE_H, r, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { commitment, blinding: r };
  }

  public buildTree(entries: Array<{ label: string; value: bigint; blinding?: bigint }>): IntervalTreeNode {
    if (entries.length === 0) {
      throw new Error('Cannot build interval sum tree with zero entries');
    }
    this.leaves = entries.map((entry, idx) => {
      const { commitment, blinding } = this.commitValue(entry.value, entry.blinding);
      return {
        index: idx,
        label: entry.label,
        value: entry.value,
        blinding,
        commitment,
      };
    });
    this.root = this.buildRange(0, this.leaves.length - 1);
    return this.root;
  }

  private hashLeaf(index: number, commitment: bigint): string {
    return sha256Hex('LEAF', String(index), commitment.toString(16));
  }

  private hashInternal(start: number, end: number, commitment: bigint, leftHash: string, rightHash: string): string {
    return sha256Hex('NODE', String(start), String(end), commitment.toString(16), leftHash, rightHash);
  }

  private buildRange(start: number, end: number): IntervalTreeNode {
    if (start === end) {
      const leaf = this.leaves[start];
      return {
        start,
        end,
        commitment: leaf.commitment,
        hash: this.hashLeaf(start, leaf.commitment),
      };
    }
    const mid = (start + end) >> 1;
    const left = this.buildRange(start, mid);
    const right = this.buildRange(mid + 1, end);
    const commitment = (left.commitment * right.commitment) % SAFE_PRIME_P;
    const hash = this.hashInternal(start, end, commitment, left.hash, right.hash);
    return { start, end, commitment, hash, left, right };
  }

  public getRoot(): IntervalTreeNode {
    if (!this.root) throw new Error('Tree not built yet');
    return this.root;
  }

  public getLeafCount(): number {
    return this.leaves.length;
  }

  private collectCoveredSubtrees(
    node: IntervalTreeNode,
    queryL: number,
    queryR: number,
    pathFromRoot: Array<{ direction: 'left' | 'right'; siblingHash: string; siblingCommitment: bigint; siblingStart: number; siblingEnd: number }>,
    out: CoveredSubtreeProof[],
  ): void {
    if (queryL <= node.start && node.end <= queryR) {
      out.push({
        start: node.start,
        end: node.end,
        commitment: node.commitment,
        nodeHash: node.hash,
        siblings: [...pathFromRoot].reverse(),
      });
      return;
    }
    if (!node.left || !node.right) return;
    const mid = (node.start + node.end) >> 1;
    if (queryL <= mid) {
      pathFromRoot.push({
        direction: 'right',
        siblingHash: node.right.hash,
        siblingCommitment: node.right.commitment,
        siblingStart: node.right.start,
        siblingEnd: node.right.end,
      });
      this.collectCoveredSubtrees(node.left, queryL, queryR, pathFromRoot, out);
      pathFromRoot.pop();
    }
    if (queryR > mid) {
      pathFromRoot.push({
        direction: 'left',
        siblingHash: node.left.hash,
        siblingCommitment: node.left.commitment,
        siblingStart: node.left.start,
        siblingEnd: node.left.end,
      });
      this.collectCoveredSubtrees(node.right, queryL, queryR, pathFromRoot, out);
      pathFromRoot.pop();
    }
  }

  private computeChallenge(
    rootHash: string,
    start: number,
    end: number,
    claimedSum: bigint,
    aggregateCommitment: bigint,
    announcementR: bigint,
    domainContext: string,
  ): bigint {
    const digest = sha256Hex(
      'INTERVAL-SUM-CHALLENGE-V1',
      rootHash,
      String(start),
      String(end),
      claimedSum.toString(16),
      aggregateCommitment.toString(16),
      announcementR.toString(16),
      domainContext,
    );
    return modScalar(BigInt('0x' + digest.slice(0, 32)));
  }

  public proveIntervalSum(start: number, end: number, domainContext = 'default'): IntervalSumOpeningProof {
    const root = this.getRoot();
    if (start < 0 || end >= this.leaves.length || start > end) {
      throw new RangeError(`Invalid query interval [${start}, ${end}] for tree of size ${this.leaves.length}`);
    }

    const coveredSubtrees: CoveredSubtreeProof[] = [];
    this.collectCoveredSubtrees(root, start, end, [], coveredSubtrees);

    let claimedSum = 0n;
    let totalBlinding = 0n;
    for (let i = start; i <= end; i++) {
      claimedSum = modScalar(claimedSum + this.leaves[i].value);
      totalBlinding = modScalar(totalBlinding + this.leaves[i].blinding);
    }

    let aggregateCommitment = 1n;
    for (const sub of coveredSubtrees) {
      aggregateCommitment = (aggregateCommitment * sub.commitment) % SAFE_PRIME_P;
    }

    // Schnorr proof of knowledge of totalBlinding such that C_agg * g^{-claimedSum} = h^{totalBlinding}
    const nonce = randomScalar();
    const announcementR = modPow(BASE_H, nonce, SAFE_PRIME_P);
    const challenge = this.computeChallenge(
      root.hash,
      start,
      end,
      claimedSum,
      aggregateCommitment,
      announcementR,
      domainContext,
    );
    const responseBlinding = modScalar(nonce + challenge * totalBlinding);

    return {
      intervalStart: start,
      intervalEnd: end,
      claimedSum,
      aggregateCommitment,
      rootHash: root.hash,
      rootCommitment: root.commitment,
      coveredSubtrees,
      announcementR,
      challenge,
      responseBlinding,
      domainContext,
    };
  }

  public verifyCoveredSubtree(subtree: CoveredSubtreeProof, expectedRootHash: string, expectedRootCommitment: bigint): boolean {
    if (subtree.start > subtree.end) return false;
    let curStart = subtree.start;
    let curEnd = subtree.end;
    let curComm = subtree.commitment;
    let curHash = subtree.start === subtree.end
      ? this.hashLeaf(subtree.start, subtree.commitment)
      : subtree.nodeHash;

    if (curHash !== subtree.nodeHash) return false;

    for (const step of subtree.siblings) {
      if (step.direction === 'right') {
        if (curEnd + 1 !== step.siblingStart) return false;
        const parentComm = (curComm * step.siblingCommitment) % SAFE_PRIME_P;
        curHash = this.hashInternal(curStart, step.siblingEnd, parentComm, curHash, step.siblingHash);
        curEnd = step.siblingEnd;
        curComm = parentComm;
      } else {
        if (step.siblingEnd + 1 !== curStart) return false;
        const parentComm = (step.siblingCommitment * curComm) % SAFE_PRIME_P;
        curHash = this.hashInternal(step.siblingStart, curEnd, parentComm, step.siblingHash, curHash);
        curStart = step.siblingStart;
        curComm = parentComm;
      }
    }

    return curHash === expectedRootHash && curComm === expectedRootCommitment;
  }

  public verifyIntervalSum(proof: IntervalSumOpeningProof): boolean {
    if (proof.intervalStart > proof.intervalEnd || proof.coveredSubtrees.length === 0) return false;

    // 1. Verify subtrees form an exact disjoint partition of [intervalStart, intervalEnd]
    let expectedNext = proof.intervalStart;
    let computedAggregate = 1n;

    for (const sub of proof.coveredSubtrees) {
      if (sub.start !== expectedNext || sub.end < sub.start) return false;
      if (!this.verifyCoveredSubtree(sub, proof.rootHash, proof.rootCommitment)) return false;
      computedAggregate = (computedAggregate * sub.commitment) % SAFE_PRIME_P;
      expectedNext = sub.end + 1;
    }

    if (expectedNext !== proof.intervalEnd + 1) return false;
    if (computedAggregate !== proof.aggregateCommitment) return false;

    // 2. Verify Fiat-Shamir challenge binding
    const expectedChallenge = this.computeChallenge(
      proof.rootHash,
      proof.intervalStart,
      proof.intervalEnd,
      proof.claimedSum,
      proof.aggregateCommitment,
      proof.announcementR,
      proof.domainContext,
    );
    if (expectedChallenge !== proof.challenge) return false;

    // 3. Verify h^{responseBlinding} == announcementR * (C_agg * g^{-claimedSum})^challenge mod P
    const gNegSum = modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(proof.claimedSum)), SAFE_PRIME_P);
    const blindingTarget = (proof.aggregateCommitment * gNegSum) % SAFE_PRIME_P;
    const lhs = modPow(BASE_H, proof.responseBlinding, SAFE_PRIME_P);
    const rhs = (proof.announcementR * modPow(blindingTarget, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public verifyBatchIntervals(proofs: IntervalSumOpeningProof[]): { allValid: boolean; failedIndices: number[] } {
    const failedIndices: number[] = [];
    for (let i = 0; i < proofs.length; i++) {
      if (!this.verifyIntervalSum(proofs[i])) {
        failedIndices.push(i);
      }
    }
    return { allValid: failedIndices.length === 0, failedIndices };
  }

  public serializeProof(proof: IntervalSumOpeningProof): string {
    return JSON.stringify({
      intervalStart: proof.intervalStart,
      intervalEnd: proof.intervalEnd,
      claimedSum: proof.claimedSum.toString(),
      aggregateCommitment: proof.aggregateCommitment.toString(16),
      rootHash: proof.rootHash,
      rootCommitment: proof.rootCommitment.toString(16),
      coveredSubtrees: proof.coveredSubtrees.map((s) => ({
        start: s.start,
        end: s.end,
        commitment: s.commitment.toString(16),
        nodeHash: s.nodeHash,
        siblings: s.siblings.map((sib) => ({
          direction: sib.direction,
          siblingHash: sib.siblingHash,
          siblingCommitment: sib.siblingCommitment.toString(16),
          siblingStart: sib.siblingStart,
          siblingEnd: sib.siblingEnd,
        })),
      })),
      announcementR: proof.announcementR.toString(16),
      challenge: proof.challenge.toString(16),
      responseBlinding: proof.responseBlinding.toString(16),
      domainContext: proof.domainContext,
    });
  }

  public deserializeProof(raw: string): IntervalSumOpeningProof {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      intervalStart: parsed.intervalStart as number,
      intervalEnd: parsed.intervalEnd as number,
      claimedSum: BigInt(parsed.claimedSum as string),
      aggregateCommitment: BigInt('0x' + (parsed.aggregateCommitment as string)),
      rootHash: parsed.rootHash as string,
      rootCommitment: BigInt('0x' + (parsed.rootCommitment as string)),
      coveredSubtrees: (parsed.coveredSubtrees as Array<Record<string, unknown>>).map((s) => ({
        start: s.start as number,
        end: s.end as number,
        commitment: BigInt('0x' + (s.commitment as string)),
        nodeHash: s.nodeHash as string,
        siblings: (s.siblings as Array<Record<string, unknown>>).map((sib) => ({
          direction: sib.direction as 'left' | 'right',
          siblingHash: sib.siblingHash as string,
          siblingCommitment: BigInt('0x' + (sib.siblingCommitment as string)),
          siblingStart: sib.siblingStart as number,
          siblingEnd: sib.siblingEnd as number,
        })),
      })),
      announcementR: BigInt('0x' + (parsed.announcementR as string)),
      challenge: BigInt('0x' + (parsed.challenge as string)),
      responseBlinding: BigInt('0x' + (parsed.responseBlinding as string)),
      domainContext: parsed.domainContext as string,
    };
  }
}
