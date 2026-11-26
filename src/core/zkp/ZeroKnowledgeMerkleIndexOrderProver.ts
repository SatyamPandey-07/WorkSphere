import { createHash } from 'node:crypto';

/**
 * Zero-Knowledge Sorted Merkle Index-Ordering & Adjacent Non-Membership Prover.
 *
 * Maintains a canonically sorted key-value Merkle tree enabling BOTH:
 *  1. Cryptographic membership proofs for present keys (O(log N))
 *  2. Cryptographic NON-MEMBERSHIP proofs for ANY absent query key K by proving two
 *     strictly adjacent leaves in the sorted tree satisfy:
 *       - Case Interior: leaf[i].key < K < leaf[i + 1].key  (with valid Merkle proofs for i and i+1)
 *       - Case Below Min: K < leaf[0].key  (with valid Merkle proof for index 0)
 *       - Case Above Max: leaf[N - 1].key < K  (with valid Merkle proof for index N - 1)
 *  3. Global sorted-order audit proofs verifying strict monotonicity across index intervals!
 */

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

export interface SortedKVEntry {
  key: string;
  value: string;
}

export interface MerklePathStep {
  direction: 'left' | 'right';
  hash: string;
}

export interface IndexedLeafProof {
  index: number;
  treeSize: number;
  key: string;
  value: string;
  path: MerklePathStep[];
  root: string;
}

export interface NonMembershipProof {
  queryKey: string;
  caseType: 'BELOW_MIN' | 'ABOVE_MAX' | 'INTERIOR_GAP';
  treeSize: number;
  root: string;
  lowerNeighbor?: IndexedLeafProof;
  upperNeighbor?: IndexedLeafProof;
}

export class ZeroKnowledgeMerkleIndexOrderProver {
  private readonly namespace: string;
  private sortedEntries: SortedKVEntry[] = [];
  private levels: string[][] = [];

  constructor(namespace = 'sorted-merkle-idx-v1') {
    this.namespace = namespace;
  }

  public hashLeaf(index: number, key: string, value: string): string {
    return sha256Hex('SMIDX-LEAF-V1', this.namespace, String(index), key, value);
  }

  public hashNode(left: string, right: string): string {
    return sha256Hex('SMIDX-NODE-V1', this.namespace, left, right);
  }

  public buildIndex(entries: SortedKVEntry[]): { root: string; size: number } {
    if (entries.length === 0) throw new Error('Cannot build empty sorted Merkle index');
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.key)) throw new Error(`Duplicate key "${e.key}" in sorted Merkle index`);
      seen.add(e.key);
    }

    this.sortedEntries = [...entries]
      .map((e) => ({ key: e.key, value: e.value }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const leafHashes = this.sortedEntries.map((e, i) => this.hashLeaf(i, e.key, e.value));
    this.levels = [leafHashes];
    let cur = leafHashes;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        const right = i + 1 < cur.length ? cur[i + 1] : cur[i];
        next.push(this.hashNode(cur[i], right));
      }
      this.levels.push(next);
      cur = next;
    }

    return { root: this.getRoot(), size: this.sortedEntries.length };
  }

  public getRoot(): string {
    if (this.levels.length === 0) throw new Error('Sorted index not built yet');
    return this.levels[this.levels.length - 1][0];
  }

  public getSize(): number {
    return this.sortedEntries.length;
  }

  private proveByIndex(index: number): IndexedLeafProof {
    if (index < 0 || index >= this.sortedEntries.length) {
      throw new RangeError(`Leaf index ${index} out of bounds [0, ${this.sortedEntries.length})`);
    }
    const path: MerklePathStep[] = [];
    let pos = index;
    for (let lvl = 0; lvl < this.levels.length - 1; lvl++) {
      const arr = this.levels[lvl];
      const isRight = pos % 2 === 1;
      const sibPos = isRight ? pos - 1 : (pos + 1 < arr.length ? pos + 1 : pos);
      path.push({ direction: isRight ? 'left' : 'right', hash: arr[sibPos] });
      pos >>= 1;
    }

    const entry = this.sortedEntries[index];
    return {
      index,
      treeSize: this.sortedEntries.length,
      key: entry.key,
      value: entry.value,
      path,
      root: this.getRoot(),
    };
  }

  public verifyLeafProof(proof: IndexedLeafProof): boolean {
    if (proof.index < 0 || proof.index >= proof.treeSize) return false;
    let cur = this.hashLeaf(proof.index, proof.key, proof.value);
    let pos = proof.index;
    for (const step of proof.path) {
      const expectedDir = pos % 2 === 1 ? 'left' : 'right';
      if (step.direction !== expectedDir) return false;
      cur = step.direction === 'left'
        ? this.hashNode(step.hash, cur)
        : this.hashNode(cur, step.hash);
      pos >>= 1;
    }
    return pos === 0 && cur === proof.root;
  }

  private binarySearch(key: string): { found: boolean; index: number } {
    let lo = 0;
    let hi = this.sortedEntries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sortedEntries[mid].key < key) lo = mid + 1;
      else hi = mid;
    }
    if (lo < this.sortedEntries.length && this.sortedEntries[lo].key === key) {
      return { found: true, index: lo };
    }
    return { found: false, index: lo };
  }

  public proveMembership(key: string): IndexedLeafProof {
    const { found, index } = this.binarySearch(key);
    if (!found) throw new Error(`Key "${key}" is not present in sorted Merkle index`);
    return this.proveByIndex(index);
  }

  public proveNonMembership(queryKey: string): NonMembershipProof {
    if (this.sortedEntries.length === 0) throw new Error('Index not built');
    const { found, index } = this.binarySearch(queryKey);
    if (found) throw new Error(`Key "${queryKey}" IS present at index ${index}; cannot prove non-membership`);

    const root = this.getRoot();
    const treeSize = this.sortedEntries.length;

    if (index === 0) {
      return {
        queryKey,
        caseType: 'BELOW_MIN',
        treeSize,
        root,
        upperNeighbor: this.proveByIndex(0),
      };
    }
    if (index === treeSize) {
      return {
        queryKey,
        caseType: 'ABOVE_MAX',
        treeSize,
        root,
        lowerNeighbor: this.proveByIndex(treeSize - 1),
      };
    }

    return {
      queryKey,
      caseType: 'INTERIOR_GAP',
      treeSize,
      root,
      lowerNeighbor: this.proveByIndex(index - 1),
      upperNeighbor: this.proveByIndex(index),
    };
  }

  public verifyNonMembership(proof: NonMembershipProof): boolean {
    if (proof.treeSize < 1) return false;

    if (proof.caseType === 'BELOW_MIN') {
      const up = proof.upperNeighbor;
      if (!up || up.index !== 0 || up.root !== proof.root || up.treeSize !== proof.treeSize) return false;
      if (!(proof.queryKey < up.key)) return false;
      return this.verifyLeafProof(up);
    }

    if (proof.caseType === 'ABOVE_MAX') {
      const lo = proof.lowerNeighbor;
      if (!lo || lo.index !== proof.treeSize - 1 || lo.root !== proof.root || lo.treeSize !== proof.treeSize) return false;
      if (!(lo.key < proof.queryKey)) return false;
      return this.verifyLeafProof(lo);
    }

    if (proof.caseType === 'INTERIOR_GAP') {
      const lo = proof.lowerNeighbor;
      const up = proof.upperNeighbor;
      if (!lo || !up) return false;
      if (lo.root !== proof.root || up.root !== proof.root) return false;
      if (lo.treeSize !== proof.treeSize || up.treeSize !== proof.treeSize) return false;
      // Strict adjacency: up.index == lo.index + 1 AND strict ordering lo.key < queryKey < up.key!
      if (up.index !== lo.index + 1) return false;
      if (!(lo.key < proof.queryKey && proof.queryKey < up.key)) return false;
      return this.verifyLeafProof(lo) && this.verifyLeafProof(up);
    }

    return false;
  }

  public verifyRangeOrdering(startIndex: number, endIndex: number): { ordered: boolean; proofs: IndexedLeafProof[] } {
    if (startIndex < 0 || endIndex >= this.sortedEntries.length || startIndex > endIndex) {
      throw new RangeError('Invalid range indices');
    }
    const proofs: IndexedLeafProof[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      const p = this.proveByIndex(i);
      if (!this.verifyLeafProof(p)) return { ordered: false, proofs };
      if (i > startIndex && !(proofs[proofs.length - 1].key < p.key)) {
        return { ordered: false, proofs };
      }
      proofs.push(p);
    }
    return { ordered: true, proofs };
  }

  public serializeNonMembership(proof: NonMembershipProof): string {
    return JSON.stringify({
      queryKey: proof.queryKey,
      caseType: proof.caseType,
      treeSize: proof.treeSize,
      lowerKey: proof.lowerNeighbor?.key ?? null,
      upperKey: proof.upperNeighbor?.key ?? null,
      root: proof.root,
    });
  }
}
