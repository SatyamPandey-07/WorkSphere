import { createHash } from 'node:crypto';

/**
 * Verifiable Deterministic Schema & Epoch State Migration Prover.
 *
 * Certifies cryptographically that an entire key-value state database migrated from
 * schema version V_old (Merkle root R_old) to schema version V_new (Merkle root R_new)
 * via a deterministic pure transformation function T(record) -> record':
 *  - Builds canonical sorted Merkle trees for both pre-migration and post-migration states
 *  - Emits a MigrationAuditCertificate linking (schemaV1, R_old) -> (schemaV2, R_new)
 *    with record-count invariants, migration rule digest, and sampled or exhaustive
 *    dual-root inclusion proof pairs certifying (record_i in R_old) AND (T(record_i) in R_new)!
 */

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

export interface StateRecord {
  id: string;
  schemaVersion: number;
  fields: Record<string, string>;
}

export interface MigrationMerkleStep {
  direction: 'left' | 'right';
  hash: string;
}

export interface RecordInclusionWitness {
  leafIndex: number;
  record: StateRecord;
  recordDigest: string;
  path: MigrationMerkleStep[];
  root: string;
}

export interface MigratedPairWitness {
  recordId: string;
  preWitness: RecordInclusionWitness;
  postWitness: RecordInclusionWitness;
}

export interface MigrationAuditCertificate {
  migrationId: string;
  fromSchemaVersion: number;
  toSchemaVersion: number;
  ruleTag: string;
  recordCount: number;
  preRoot: string;
  postRoot: string;
  pairWitnesses: MigratedPairWitness[];
  certificateDigest: string;
}

export type RecordTransformFn = (oldRec: StateRecord) => StateRecord;

export class VerifiableEpochStateMigrationProver {
  public canonicalizeRecord(rec: StateRecord): string {
    const sortedKeys = Object.keys(rec.fields).sort();
    const body = sortedKeys.map((k) => `${k}=${rec.fields[k]}`).join('&');
    return sha256Hex('MIG-REC-V1', rec.id, String(rec.schemaVersion), body);
  }

  private hashNode(left: string, right: string): string {
    return sha256Hex('MIG-NODE-V1', left, right);
  }

  private buildTree(records: StateRecord[]): { sorted: StateRecord[]; digests: string[]; root: string; levels: string[][] } {
    if (records.length === 0) throw new Error('State table cannot be empty');
    const seen = new Set<string>();
    const sorted = [...records]
      .map((r) => ({ id: r.id, schemaVersion: r.schemaVersion, fields: { ...r.fields } }))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const r of sorted) {
      if (seen.has(r.id)) throw new Error(`Duplicate record id "${r.id}"`);
      seen.add(r.id);
    }

    const digests = sorted.map((r) => this.canonicalizeRecord(r));
    const levels: string[][] = [digests.map((d, i) => sha256Hex('MIG-LEAF-V1', String(i), d))];
    let cur = levels[0];
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(this.hashNode(cur[i], i + 1 < cur.length ? cur[i + 1] : cur[i]));
      }
      levels.push(next);
      cur = next;
    }

    return { sorted, digests, root: cur[0], levels };
  }

  private extractWitness(
    tree: { sorted: StateRecord[]; digests: string[]; root: string; levels: string[][] },
    idx: number,
  ): RecordInclusionWitness {
    const path: MigrationMerkleStep[] = [];
    let pos = idx;
    for (let lvl = 0; lvl < tree.levels.length - 1; lvl++) {
      const arr = tree.levels[lvl];
      const isRight = pos % 2 === 1;
      const sibPos = isRight ? pos - 1 : (pos + 1 < arr.length ? pos + 1 : pos);
      path.push({ direction: isRight ? 'left' : 'right', hash: arr[sibPos] });
      pos >>= 1;
    }
    return {
      leafIndex: idx,
      record: tree.sorted[idx],
      recordDigest: tree.digests[idx],
      path,
      root: tree.root,
    };
  }

  public verifyInclusionWitness(w: RecordInclusionWitness): boolean {
    if (this.canonicalizeRecord(w.record) !== w.recordDigest) return false;
    let cur = sha256Hex('MIG-LEAF-V1', String(w.leafIndex), w.recordDigest);
    let pos = w.leafIndex;
    for (const step of w.path) {
      const expectedDir = pos % 2 === 1 ? 'left' : 'right';
      if (step.direction !== expectedDir) return false;
      cur = step.direction === 'left'
        ? this.hashNode(step.hash, cur)
        : this.hashNode(cur, step.hash);
      pos >>= 1;
    }
    return pos === 0 && cur === w.root;
  }

  private computeCertDigest(cert: Omit<MigrationAuditCertificate, 'certificateDigest'>): string {
    return sha256Hex(
      'MIG-CERT-V1',
      cert.migrationId,
      String(cert.fromSchemaVersion),
      String(cert.toSchemaVersion),
      cert.ruleTag,
      String(cert.recordCount),
      cert.preRoot,
      cert.postRoot,
      ...cert.pairWitnesses.map((p) => `${p.recordId}:${p.preWitness.recordDigest}->${p.postWitness.recordDigest}`),
    );
  }

  public executeAndProveMigration(params: {
    migrationId: string;
    fromSchemaVersion: number;
    toSchemaVersion: number;
    ruleTag: string;
    preRecords: StateRecord[];
    transform: RecordTransformFn;
    auditSampleIndices?: number[];
  }): { certificate: MigrationAuditCertificate; migratedRecords: StateRecord[] } {
    if (params.toSchemaVersion <= params.fromSchemaVersion) {
      throw new RangeError('Target schema version must exceed source schema version');
    }

    const preTree = this.buildTree(params.preRecords);
    for (const rec of preTree.sorted) {
      if (rec.schemaVersion !== params.fromSchemaVersion) {
        throw new Error(`Record "${rec.id}" has schemaVersion ${rec.schemaVersion}, expected ${params.fromSchemaVersion}`);
      }
    }

    const postRecords = preTree.sorted.map((rec) => {
      const next = params.transform({ id: rec.id, schemaVersion: rec.schemaVersion, fields: { ...rec.fields } });
      if (next.id !== rec.id || next.schemaVersion !== params.toSchemaVersion) {
        throw new Error(`Transform produced invalid id/version for record "${rec.id}"`);
      }
      return next;
    });
    const postTree = this.buildTree(postRecords);

    const indices = params.auditSampleIndices
      ? [...new Set(params.auditSampleIndices)].sort((a, b) => a - b)
      : preTree.sorted.map((_, i) => i);

    const pairWitnesses: MigratedPairWitness[] = indices.map((idx) => {
      if (idx < 0 || idx >= preTree.sorted.length) throw new RangeError(`Sample index ${idx} out of bounds`);
      return {
        recordId: preTree.sorted[idx].id,
        preWitness: this.extractWitness(preTree, idx),
        postWitness: this.extractWitness(postTree, idx),
      };
    });

    const base = {
      migrationId: params.migrationId,
      fromSchemaVersion: params.fromSchemaVersion,
      toSchemaVersion: params.toSchemaVersion,
      ruleTag: params.ruleTag,
      recordCount: preTree.sorted.length,
      preRoot: preTree.root,
      postRoot: postTree.root,
      pairWitnesses,
    };

    return {
      certificate: { ...base, certificateDigest: this.computeCertDigest(base) },
      migratedRecords: postTree.sorted,
    };
  }

  public verifyMigrationCertificate(cert: MigrationAuditCertificate, transform: RecordTransformFn): boolean {
    if (cert.toSchemaVersion <= cert.fromSchemaVersion || cert.pairWitnesses.length === 0) return false;
    if (this.computeCertDigest(cert) !== cert.certificateDigest) return false;

    const seenIds = new Set<string>();
    for (const pair of cert.pairWitnesses) {
      if (seenIds.has(pair.recordId)) return false;
      seenIds.add(pair.recordId);

      const pre = pair.preWitness;
      const post = pair.postWitness;
      if (
        pre.record.id !== pair.recordId ||
        post.record.id !== pair.recordId ||
        pre.leafIndex !== post.leafIndex ||
        pre.root !== cert.preRoot ||
        post.root !== cert.postRoot ||
        pre.record.schemaVersion !== cert.fromSchemaVersion ||
        post.record.schemaVersion !== cert.toSchemaVersion
      ) {
        return false;
      }

      if (!this.verifyInclusionWitness(pre) || !this.verifyInclusionWitness(post)) return false;

      // Re-run deterministic transform on pre.record and verify digest matches post.record!
      const expectedPost = transform({
        id: pre.record.id,
        schemaVersion: pre.record.schemaVersion,
        fields: { ...pre.record.fields },
      });
      if (this.canonicalizeRecord(expectedPost) !== post.recordDigest) return false;
    }

    return true;
  }

  public verifyMigrationChain(certs: MigrationAuditCertificate[], transforms: RecordTransformFn[]): boolean {
    if (certs.length === 0 || certs.length !== transforms.length) return false;
    for (let i = 0; i < certs.length; i++) {
      if (!this.verifyMigrationCertificate(certs[i], transforms[i])) return false;
      if (i > 0) {
        const prev = certs[i - 1];
        if (
          certs[i].fromSchemaVersion !== prev.toSchemaVersion ||
          certs[i].preRoot !== prev.postRoot ||
          certs[i].recordCount !== prev.recordCount
        ) {
          return false;
        }
      }
    }
    return true;
  }

  public serializeCertificate(cert: MigrationAuditCertificate): string {
    return JSON.stringify({
      migrationId: cert.migrationId,
      fromSchemaVersion: cert.fromSchemaVersion,
      toSchemaVersion: cert.toSchemaVersion,
      recordCount: cert.recordCount,
      witnessCount: cert.pairWitnesses.length,
      preRoot: cert.preRoot,
      postRoot: cert.postRoot,
    });
  }
}
