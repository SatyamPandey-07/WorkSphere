import { createHash } from 'node:crypto';

/**
 * Zero-Knowledge Merkle Snapshot Diff Prover.
 *
 * Computes and cryptographically verifies the exact minimal state diff (inserts, updates,
 * deletes) between two sorted Merkle state snapshots (Snapshot A -> Snapshot B):
 *  - Deterministic sorted key-value Merkle tree with domain-separated leaf & node hashing
 *  - Emits a compact SnapshotDiffCertificate containing:
 *      - rootA, rootB, unchangedCount, inserted, updated, deleted
 *      - Merkle inclusion proofs against rootA for every updated/deleted old value
 *      - Merkle inclusion proofs against rootB for every inserted/updated new value
 *      - Cryptographic transition digest binding both roots and every diff entry
 *  - Verifier confirms every claimed change is genuinely backed by rootA and rootB AND
 *    applies the diff patch to a base snapshot to verify exact rootB reconstruction!
 */

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

export interface SnapshotMerkleStep {
  direction: 'left' | 'right';
  hash: string;
}

export interface KeyInclusionProof {
  key: string;
  value: string;
  leafIndex: number;
  path: SnapshotMerkleStep[];
  root: string;
}

export interface SnapshotState {
  version: number;
  entries: Record<string, string>;
  sortedKeys: string[];
  root: string;
  levels: string[][];
}

export interface DiffInsertEntry {
  key: string;
  newValue: string;
  proofInTarget: KeyInclusionProof;
}

export interface DiffUpdateEntry {
  key: string;
  oldValue: string;
  newValue: string;
  proofInSource: KeyInclusionProof;
  proofInTarget: KeyInclusionProof;
}

export interface DiffDeleteEntry {
  key: string;
  oldValue: string;
  proofInSource: KeyInclusionProof;
}

export interface SnapshotDiffCertificate {
  sourceVersion: number;
  targetVersion: number;
  sourceRoot: string;
  targetRoot: string;
  sourceKeyCount: number;
  targetKeyCount: number;
  inserts: DiffInsertEntry[];
  updates: DiffUpdateEntry[];
  deletes: DiffDeleteEntry[];
  diffDigest: string;
}

export class ZeroKnowledgeMerkleSnapshotDiffProver {
  private hashLeaf(key: string, value: string): string {
    return sha256Hex('SNAP-LEAF-V1', key, value);
  }

  private hashNode(left: string, right: string): string {
    return sha256Hex('SNAP-NODE-V1', left, right);
  }

  public buildSnapshot(version: number, entries: Record<string, string>): SnapshotState {
    const sortedKeys = Object.keys(entries).sort();
    const copied: Record<string, string> = {};
    for (const k of sortedKeys) copied[k] = entries[k];

    if (sortedKeys.length === 0) {
      const emptyRoot = sha256Hex('SNAP-EMPTY-ROOT-V1');
      return { version, entries: copied, sortedKeys, root: emptyRoot, levels: [[emptyRoot]] };
    }

    const leaves = sortedKeys.map((k) => this.hashLeaf(k, copied[k]));
    const levels: string[][] = [leaves];
    let cur = leaves;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        const right = i + 1 < cur.length ? cur[i + 1] : cur[i];
        next.push(this.hashNode(cur[i], right));
      }
      levels.push(next);
      cur = next;
    }

    return { version, entries: copied, sortedKeys, root: cur[0], levels };
  }

  public proveKeyInclusion(snap: SnapshotState, key: string): KeyInclusionProof {
    const idx = snap.sortedKeys.indexOf(key);
    if (idx === -1) throw new Error(`Key "${key}" not present in snapshot v${snap.version}`);

    const path: SnapshotMerkleStep[] = [];
    let pos = idx;
    for (let lvl = 0; lvl < snap.levels.length - 1; lvl++) {
      const arr = snap.levels[lvl];
      const isRight = pos % 2 === 1;
      const sibPos = isRight ? pos - 1 : (pos + 1 < arr.length ? pos + 1 : pos);
      path.push({ direction: isRight ? 'left' : 'right', hash: arr[sibPos] });
      pos >>= 1;
    }

    return {
      key,
      value: snap.entries[key],
      leafIndex: idx,
      path,
      root: snap.root,
    };
  }

  public verifyKeyInclusion(proof: KeyInclusionProof): boolean {
    let cur = this.hashLeaf(proof.key, proof.value);
    for (const step of proof.path) {
      cur = step.direction === 'left'
        ? this.hashNode(step.hash, cur)
        : this.hashNode(cur, step.hash);
    }
    return cur === proof.root;
  }

  private computeDiffDigest(
    sourceVersion: number,
    targetVersion: number,
    sourceRoot: string,
    targetRoot: string,
    inserts: DiffInsertEntry[],
    updates: DiffUpdateEntry[],
    deletes: DiffDeleteEntry[],
  ): string {
    return sha256Hex(
      'SNAP-DIFF-CERT-V1',
      String(sourceVersion),
      String(targetVersion),
      sourceRoot,
      targetRoot,
      ...inserts.map((i) => `+:${i.key}=${i.newValue}`),
      ...updates.map((u) => `~:${u.key}:${u.oldValue}->${u.newValue}`),
      ...deletes.map((d) => `-:${d.key}=${d.oldValue}`),
    );
  }

  public computeDiffCertificate(source: SnapshotState, target: SnapshotState): SnapshotDiffCertificate {
    if (target.version <= source.version) {
      throw new RangeError('Target snapshot version must be strictly greater than source version');
    }

    const inserts: DiffInsertEntry[] = [];
    const updates: DiffUpdateEntry[] = [];
    const deletes: DiffDeleteEntry[] = [];

    for (const key of target.sortedKeys) {
      if (!(key in source.entries)) {
        inserts.push({
          key,
          newValue: target.entries[key],
          proofInTarget: this.proveKeyInclusion(target, key),
        });
      } else if (source.entries[key] !== target.entries[key]) {
        updates.push({
          key,
          oldValue: source.entries[key],
          newValue: target.entries[key],
          proofInSource: this.proveKeyInclusion(source, key),
          proofInTarget: this.proveKeyInclusion(target, key),
        });
      }
    }

    for (const key of source.sortedKeys) {
      if (!(key in target.entries)) {
        deletes.push({
          key,
          oldValue: source.entries[key],
          proofInSource: this.proveKeyInclusion(source, key),
        });
      }
    }

    const diffDigest = this.computeDiffDigest(
      source.version,
      target.version,
      source.root,
      target.root,
      inserts,
      updates,
      deletes,
    );

    return {
      sourceVersion: source.version,
      targetVersion: target.version,
      sourceRoot: source.root,
      targetRoot: target.root,
      sourceKeyCount: source.sortedKeys.length,
      targetKeyCount: target.sortedKeys.length,
      inserts,
      updates,
      deletes,
      diffDigest,
    };
  }

  public verifyDiffCertificate(cert: SnapshotDiffCertificate): boolean {
    if (cert.targetVersion <= cert.sourceVersion) return false;
    if (cert.sourceKeyCount + cert.inserts.length - cert.deletes.length !== cert.targetKeyCount) return false;

    const expectedDigest = this.computeDiffDigest(
      cert.sourceVersion,
      cert.targetVersion,
      cert.sourceRoot,
      cert.targetRoot,
      cert.inserts,
      cert.updates,
      cert.deletes,
    );
    if (expectedDigest !== cert.diffDigest) return false;

    const touchedKeys = new Set<string>();

    for (const ins of cert.inserts) {
      if (touchedKeys.has(ins.key)) return false;
      touchedKeys.add(ins.key);
      if (ins.proofInTarget.key !== ins.key || ins.proofInTarget.value !== ins.newValue || ins.proofInTarget.root !== cert.targetRoot) {
        return false;
      }
      if (!this.verifyKeyInclusion(ins.proofInTarget)) return false;
    }

    for (const upd of cert.updates) {
      if (touchedKeys.has(upd.key) || upd.oldValue === upd.newValue) return false;
      touchedKeys.add(upd.key);
      if (upd.proofInSource.key !== upd.key || upd.proofInSource.value !== upd.oldValue || upd.proofInSource.root !== cert.sourceRoot) {
        return false;
      }
      if (upd.proofInTarget.key !== upd.key || upd.proofInTarget.value !== upd.newValue || upd.proofInTarget.root !== cert.targetRoot) {
        return false;
      }
      if (!this.verifyKeyInclusion(upd.proofInSource) || !this.verifyKeyInclusion(upd.proofInTarget)) return false;
    }

    for (const del of cert.deletes) {
      if (touchedKeys.has(del.key)) return false;
      touchedKeys.add(del.key);
      if (del.proofInSource.key !== del.key || del.proofInSource.value !== del.oldValue || del.proofInSource.root !== cert.sourceRoot) {
        return false;
      }
      if (!this.verifyKeyInclusion(del.proofInSource)) return false;
    }

    return true;
  }

  /**
   * Applies a verified diff certificate onto a local source snapshot and confirms the
   * resulting Merkle root matches cert.targetRoot bit-for-bit!
   */
  public applyAndVerifyPatch(source: SnapshotState, cert: SnapshotDiffCertificate): { applied: boolean; targetSnapshot?: SnapshotState } {
    if (source.root !== cert.sourceRoot || source.version !== cert.sourceVersion) {
      return { applied: false };
    }
    if (!this.verifyDiffCertificate(cert)) return { applied: false };

    const nextEntries: Record<string, string> = { ...source.entries };
    for (const del of cert.deletes) {
      if (nextEntries[del.key] !== del.oldValue) return { applied: false };
      delete nextEntries[del.key];
    }
    for (const upd of cert.updates) {
      if (nextEntries[upd.key] !== upd.oldValue) return { applied: false };
      nextEntries[upd.key] = upd.newValue;
    }
    for (const ins of cert.inserts) {
      if (ins.key in nextEntries) return { applied: false };
      nextEntries[ins.key] = ins.newValue;
    }

    const reconstructed = this.buildSnapshot(cert.targetVersion, nextEntries);
    if (reconstructed.root !== cert.targetRoot) return { applied: false };
    return { applied: true, targetSnapshot: reconstructed };
  }

  public serializeCertificate(cert: SnapshotDiffCertificate): string {
    return JSON.stringify({
      sourceVersion: cert.sourceVersion,
      targetVersion: cert.targetVersion,
      insertCount: cert.inserts.length,
      updateCount: cert.updates.length,
      deleteCount: cert.deletes.length,
      diffDigest: cert.diffDigest,
    });
  }
}
