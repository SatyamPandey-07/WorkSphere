import { createHash } from 'node:crypto';

/**
 * Verifiable Quaternary (4-ary) Hash Tree Consistency & Multi-Leaf Audit Prover.
 *
 * Implements a wide-branching 4-ary Merkle hash tree (halving tree height compared to
 * binary Merkle trees for bandwidth-constrained L1/L2 state verification):
 *  - Domain-separated leaf hashing: H('Q4-LEAF' || index || key || value)
 *  - Domain-separated 4-child node hashing: H('Q4-NODE' || c0 || c1 || c2 || c3)
 *  - Compact O(log_4 N) inclusion proofs carrying up to 3 siblings per level
 *  - Deduplicated multi-leaf batch verification + historical snapshot checkpoint tracking
 *  - Root-to-root append consistency verification proving older checkpoints remain intact!
 */

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

const EMPTY_CHILD = sha256Hex('Q4-EMPTY-SLOT-V1');

export interface Q4Entry {
  key: string;
  value: string;
}

export interface Q4LevelStep {
  childPosition: 0 | 1 | 2 | 3;
  siblings: [string, string, string]; // the other 3 children in ascending slot order
}

export interface Q4InclusionProof {
  leafIndex: number;
  treeSize: number;
  entry: Q4Entry;
  steps: Q4LevelStep[];
  root: string;
}

export interface Q4Checkpoint {
  version: number;
  treeSize: number;
  root: string;
  checkpointHash: string;
}

export interface Q4AppendConsistencyProof {
  oldCheckpoint: Q4Checkpoint;
  newCheckpoint: Q4Checkpoint;
  appendedEntries: Q4Entry[];
  verifiedBoundaryProofs: Q4InclusionProof[];
}

export class VerifiableHashTreeConsistencyProver {
  private readonly treeId: string;
  private entries: Q4Entry[] = [];
  private checkpoints: Q4Checkpoint[] = [];

  constructor(treeId: string) {
    this.treeId = treeId;
  }

  public hashLeaf(index: number, entry: Q4Entry): string {
    return sha256Hex('Q4-LEAF-V1', this.treeId, String(index), entry.key, entry.value);
  }

  public hashQuadNode(children: [string, string, string, string]): string {
    return sha256Hex('Q4-NODE-V1', this.treeId, children[0], children[1], children[2], children[3]);
  }

  private buildLevels(items: Q4Entry[]): { root: string; levels: string[][] } {
    if (items.length === 0) {
      const emptyRoot = sha256Hex('Q4-EMPTY-ROOT-V1', this.treeId);
      return { root: emptyRoot, levels: [[emptyRoot]] };
    }

    const levels: string[][] = [items.map((entry, i) => this.hashLeaf(i, entry))];
    let cur = levels[0];
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 4) {
        const quad: [string, string, string, string] = [
          cur[i],
          i + 1 < cur.length ? cur[i + 1] : EMPTY_CHILD,
          i + 2 < cur.length ? cur[i + 2] : EMPTY_CHILD,
          i + 3 < cur.length ? cur[i + 3] : EMPTY_CHILD,
        ];
        next.push(this.hashQuadNode(quad));
      }
      levels.push(next);
      cur = next;
    }

    return { root: cur[0], levels };
  }

  public appendEntries(batch: Q4Entry[]): Q4Checkpoint {
    if (batch.length === 0) throw new Error('Append batch cannot be empty');
    for (const e of batch) this.entries.push({ key: e.key, value: e.value });

    const { root } = this.buildLevels(this.entries);
    const version = this.checkpoints.length + 1;
    const prevHash = this.checkpoints.length === 0
      ? sha256Hex('Q4-CP-GENESIS', this.treeId)
      : this.checkpoints[this.checkpoints.length - 1].checkpointHash;

    const cp: Q4Checkpoint = {
      version,
      treeSize: this.entries.length,
      root,
      checkpointHash: sha256Hex('Q4-CP-V1', this.treeId, String(version), String(this.entries.length), root, prevHash),
    };
    this.checkpoints.push(cp);
    return { ...cp };
  }

  public getSize(): number {
    return this.entries.length;
  }

  public getRootAtSize(size: number): string {
    if (size < 0 || size > this.entries.length) throw new RangeError('Requested size out of bounds');
    return this.buildLevels(this.entries.slice(0, size)).root;
  }

  public getCheckpoints(): Q4Checkpoint[] {
    return this.checkpoints.map((c) => ({ ...c }));
  }

  public proveInclusion(leafIndex: number, treeSize = this.entries.length): Q4InclusionProof {
    if (treeSize < 1 || treeSize > this.entries.length || leafIndex < 0 || leafIndex >= treeSize) {
      throw new RangeError('Leaf index or tree size out of bounds');
    }

    const slice = this.entries.slice(0, treeSize);
    const { root, levels } = this.buildLevels(slice);
    const steps: Q4LevelStep[] = [];
    let pos = leafIndex;

    for (let lvl = 0; lvl < levels.length - 1; lvl++) {
      const arr = levels[lvl];
      const groupStart = pos - (pos % 4);
      const childPosition = (pos % 4) as 0 | 1 | 2 | 3;
      const sibs: string[] = [];
      for (let offset = 0; offset < 4; offset++) {
        if (offset === childPosition) continue;
        const idx = groupStart + offset;
        sibs.push(idx < arr.length ? arr[idx] : EMPTY_CHILD);
      }
      steps.push({ childPosition, siblings: [sibs[0], sibs[1], sibs[2]] });
      pos = Math.floor(pos / 4);
    }

    return {
      leafIndex,
      treeSize,
      entry: { ...slice[leafIndex] },
      steps,
      root,
    };
  }

  public verifyInclusion(proof: Q4InclusionProof): boolean {
    if (proof.leafIndex < 0 || proof.leafIndex >= proof.treeSize) return false;
    let cur = this.hashLeaf(proof.leafIndex, proof.entry);
    let pos = proof.leafIndex;

    for (const step of proof.steps) {
      if (pos % 4 !== step.childPosition) return false;
      const quad: string[] = [];
      let sIdx = 0;
      for (let slot = 0; slot < 4; slot++) {
        if (slot === step.childPosition) {
          quad.push(cur);
        } else {
          quad.push(step.siblings[sIdx++]);
        }
      }
      cur = this.hashQuadNode([quad[0], quad[1], quad[2], quad[3]]);
      pos = Math.floor(pos / 4);
    }

    return pos === 0 && cur === proof.root;
  }

  public verifyBatchInclusions(proofs: Q4InclusionProof[], expectedRoot: string): { allValid: boolean; failedIndices: number[] } {
    const failedIndices: number[] = [];
    for (let i = 0; i < proofs.length; i++) {
      if (proofs[i].root !== expectedRoot || !this.verifyInclusion(proofs[i])) {
        failedIndices.push(i);
      }
    }
    return { allValid: failedIndices.length === 0, failedIndices };
  }

  public proveAppendConsistency(oldCpVersion: number, newCpVersion: number): Q4AppendConsistencyProof {
    const oldCp = this.checkpoints.find((c) => c.version === oldCpVersion);
    const newCp = this.checkpoints.find((c) => c.version === newCpVersion);
    if (!oldCp || !newCp || newCp.version <= oldCp.version) {
      throw new Error('Invalid checkpoint versions for append consistency proof');
    }

    const appendedEntries = this.entries.slice(oldCp.treeSize, newCp.treeSize).map((e) => ({ ...e }));
    // Include boundary proofs for old first leaf, old last leaf, and new last leaf inside newCp!
    const boundaryIndices = [...new Set([0, oldCp.treeSize - 1, oldCp.treeSize, newCp.treeSize - 1])].filter(
      (idx) => idx >= 0 && idx < newCp.treeSize,
    );
    const verifiedBoundaryProofs = boundaryIndices.map((idx) => this.proveInclusion(idx, newCp.treeSize));

    return {
      oldCheckpoint: { ...oldCp },
      newCheckpoint: { ...newCp },
      appendedEntries,
      verifiedBoundaryProofs,
    };
  }

  public verifyAppendConsistency(proof: Q4AppendConsistencyProof, oldEntriesSnapshot: Q4Entry[]): boolean {
    const { oldCheckpoint, newCheckpoint, appendedEntries, verifiedBoundaryProofs } = proof;
    if (newCheckpoint.version <= oldCheckpoint.version) return false;
    if (oldEntriesSnapshot.length !== oldCheckpoint.treeSize) return false;
    if (oldCheckpoint.treeSize + appendedEntries.length !== newCheckpoint.treeSize) return false;

    const oldRebuilt = this.buildLevels(oldEntriesSnapshot).root;
    if (oldRebuilt !== oldCheckpoint.root) return false;

    const combined = [...oldEntriesSnapshot, ...appendedEntries];
    const newRebuilt = this.buildLevels(combined).root;
    if (newRebuilt !== newCheckpoint.root) return false;

    for (const bp of verifiedBoundaryProofs) {
      if (bp.root !== newCheckpoint.root || bp.treeSize !== newCheckpoint.treeSize) return false;
      if (!this.verifyInclusion(bp)) return false;
    }

    return verifiedBoundaryProofs.length > 0;
  }

  public serializeCheckpoint(cp: Q4Checkpoint): string {
    return JSON.stringify(cp);
  }
}
