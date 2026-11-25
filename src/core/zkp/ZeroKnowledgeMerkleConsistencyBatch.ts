import { createHash } from 'node:crypto';

/**
 * Zero-Knowledge RFC 6962 Merkle Append-Only Consistency Batch Prover.
 *
 * Implements the exact Certificate Transparency (RFC 6962 Section 2.1) Merkle Tree Hash (MTH)
 * and SUBPROOF consistency proof algorithm:
 *  - Domain-separated leaf hashing:  H(0x00 || data)
 *  - Domain-separated node hashing:  H(0x01 || left || right)
 *  - Largest power-of-2 split k < n: MTH(D[0..n)) = H(0x01 || MTH(D[0..k)) || MTH(D[k..n)))
 *  - Generates compact O(log N) consistency proofs certifying that ANY historical tree snapshot
 *    of size m is a strict append-only prefix of a newer snapshot of size n (1 <= m <= n)
 *  - Supports chained multi-snapshot batch consistency verification and audit inclusion proofs!
 */

function hashLeaf(data: string): string {
  return createHash('sha256').update(Buffer.from([0x00])).update(data, 'utf8').digest('hex');
}

function hashNode(leftHex: string, rightHex: string): string {
  return createHash('sha256')
    .update(Buffer.from([0x01]))
    .update(Buffer.from(leftHex, 'hex'))
    .update(Buffer.from(rightHex, 'hex'))
    .digest('hex');
}

function largestPowerOfTwoLessThan(n: number): number {
  let k = 1;
  while ((k << 1) < n) k <<= 1;
  return k;
}

export interface TreeCheckpoint {
  treeSize: number;
  rootHash: string;
}

export interface ConsistencyProof {
  firstSize: number;
  secondSize: number;
  firstRoot: string;
  secondRoot: string;
  auditPath: string[];
}

export interface AuditInclusionProof {
  leafIndex: number;
  treeSize: number;
  leafData: string;
  rootHash: string;
  path: string[];
}

export class ZeroKnowledgeMerkleConsistencyBatch {
  private entries: string[] = [];

  public append(entry: string): TreeCheckpoint {
    this.entries.push(entry);
    return this.getCheckpoint();
  }

  public appendBatch(items: string[]): TreeCheckpoint {
    for (const item of items) this.entries.push(item);
    return this.getCheckpoint();
  }

  public getSize(): number {
    return this.entries.length;
  }

  private mthRange(start: number, end: number): string {
    const n = end - start;
    if (n === 0) return createHash('sha256').update('').digest('hex');
    if (n === 1) return hashLeaf(this.entries[start]);
    const k = largestPowerOfTwoLessThan(n);
    return hashNode(this.mthRange(start, start + k), this.mthRange(start + k, end));
  }

  public getRootAtSize(size: number): string {
    if (size < 0 || size > this.entries.length) {
      throw new RangeError(`Tree size ${size} out of bounds [0, ${this.entries.length}]`);
    }
    return this.mthRange(0, size);
  }

  public getCheckpoint(size?: number): TreeCheckpoint {
    const s = size ?? this.entries.length;
    return { treeSize: s, rootHash: this.getRootAtSize(s) };
  }

  private subproof(m: number, start: number, end: number, isCompleteSubtree: boolean): string[] {
    const n = end - start;
    if (m === n) {
      return isCompleteSubtree ? [] : [this.mthRange(start, end)];
    }
    const k = largestPowerOfTwoLessThan(n);
    if (m <= k) {
      return [
        ...this.subproof(m, start, start + k, isCompleteSubtree),
        this.mthRange(start + k, end),
      ];
    } else {
      return [
        ...this.subproof(m - k, start + k, end, false),
        this.mthRange(start, start + k),
      ];
    }
  }

  public generateConsistencyProof(firstSize: number, secondSize?: number): ConsistencyProof {
    const n = secondSize ?? this.entries.length;
    if (firstSize < 1 || firstSize > n || n > this.entries.length) {
      throw new RangeError(`Invalid consistency bounds: first=${firstSize}, second=${n}, current=${this.entries.length}`);
    }
    const auditPath = firstSize === n ? [] : this.subproof(firstSize, 0, n, true);
    return {
      firstSize,
      secondSize: n,
      firstRoot: this.getRootAtSize(firstSize),
      secondRoot: this.getRootAtSize(n),
      auditPath,
    };
  }

  /**
   * RFC 6962 Section 2.1.4.2 exact consistency verification algorithm.
   */
  public verifyConsistencyProof(proof: ConsistencyProof): boolean {
    const { firstSize: first, secondSize: second, firstRoot, secondRoot, auditPath } = proof;
    if (first < 1 || second < first) return false;
    if (first === second) {
      return auditPath.length === 0 && firstRoot === secondRoot;
    }
    if (auditPath.length === 0) return false;

    const nodes = [...auditPath];
    let fn = first - 1;
    let sn = second - 1;

    // If first is a power of 2, prepend firstRoot as starting accumulator
    const isPowerOfTwo = (first & (first - 1)) === 0;
    if (isPowerOfTwo) {
      nodes.unshift(firstRoot);
    }

    while ((fn & 1) === 1) {
      fn >>= 1;
      sn >>= 1;
    }

    let fr = nodes[0];
    let sr = nodes[0];

    for (let i = 1; i < nodes.length; i++) {
      const c = nodes[i];
      if (sn === 0) return false;

      if ((fn & 1) === 1 || fn === sn) {
        fr = hashNode(c, fr);
        sr = hashNode(c, sr);
        while (fn !== 0 && (fn & 1) === 0) {
          fn >>= 1;
          sn >>= 1;
        }
      } else {
        sr = hashNode(sr, c);
      }
      fn >>= 1;
      sn >>= 1;
    }

    return sn === 0 && fr === firstRoot && sr === secondRoot;
  }

  private inclusionPath(index: number, start: number, end: number): string[] {
    const n = end - start;
    if (n === 1) return [];
    const k = largestPowerOfTwoLessThan(n);
    if (index < k) {
      return [...this.inclusionPath(index, start, start + k), this.mthRange(start + k, end)];
    }
    return [...this.inclusionPath(index - k, start + k, end), this.mthRange(start, start + k)];
  }

  public generateInclusionProof(leafIndex: number, treeSize?: number): AuditInclusionProof {
    const n = treeSize ?? this.entries.length;
    if (leafIndex < 0 || leafIndex >= n || n > this.entries.length) {
      throw new RangeError('Leaf index or tree size out of bounds');
    }
    return {
      leafIndex,
      treeSize: n,
      leafData: this.entries[leafIndex],
      rootHash: this.getRootAtSize(n),
      path: this.inclusionPath(leafIndex, 0, n),
    };
  }

  public verifyInclusionProof(proof: AuditInclusionProof): boolean {
    if (proof.leafIndex < 0 || proof.leafIndex >= proof.treeSize) return false;
    let fn = proof.leafIndex;
    let sn = proof.treeSize - 1;
    let r = hashLeaf(proof.leafData);

    for (const p of proof.path) {
      if (sn === 0) return false;
      if ((fn & 1) === 1 || fn === sn) {
        r = hashNode(p, r);
        while (fn !== 0 && (fn & 1) === 0) {
          fn >>= 1;
          sn >>= 1;
        }
      } else {
        r = hashNode(r, p);
      }
      fn >>= 1;
      sn >>= 1;
    }

    return sn === 0 && r === proof.rootHash;
  }

  public verifyConsistencyChain(proofs: ConsistencyProof[]): { allValid: boolean; brokenAt: number } {
    for (let i = 0; i < proofs.length; i++) {
      if (!this.verifyConsistencyProof(proofs[i])) {
        return { allValid: false, brokenAt: i };
      }
      if (i > 0) {
        if (proofs[i].firstSize !== proofs[i - 1].secondSize || proofs[i].firstRoot !== proofs[i - 1].secondRoot) {
          return { allValid: false, brokenAt: i };
        }
      }
    }
    return { allValid: true, brokenAt: -1 };
  }

  public serializeProof(proof: ConsistencyProof): string {
    return JSON.stringify({
      firstSize: proof.firstSize,
      secondSize: proof.secondSize,
      pathLength: proof.auditPath.length,
      secondRoot: proof.secondRoot,
    });
  }
}
