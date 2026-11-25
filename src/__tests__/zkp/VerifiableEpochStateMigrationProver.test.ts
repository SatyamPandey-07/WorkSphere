import { describe, it, expect } from 'vitest';
import { VerifiableEpochStateMigrationProver, type StateRecord } from '../../core/zkp/VerifiableEpochStateMigrationProver';

describe('VerifiableEpochStateMigrationProver', () => {
  const migrator = new VerifiableEpochStateMigrationProver();

  const v1ToV2 = (rec: StateRecord): StateRecord => ({
    id: rec.id,
    schemaVersion: 2,
    fields: {
      ...rec.fields,
      balanceCents: String(Number(rec.fields.balanceDollars) * 100),
      currency: 'USD',
    },
  });

  const v2ToV3 = (rec: StateRecord): StateRecord => ({
    id: rec.id,
    schemaVersion: 3,
    fields: {
      balanceCents: rec.fields.balanceCents,
      currency: rec.fields.currency,
      tier: Number(rec.fields.balanceCents) >= 50000 ? 'PRO' : 'BASIC',
    },
  });

  it('proves multi-step deterministic schema migrations v1 -> v2 -> v3 and rejects tampered transforms', () => {
    const v1Records: StateRecord[] = [
      { id: 'acct-3', schemaVersion: 1, fields: { balanceDollars: '750' } },
      { id: 'acct-1', schemaVersion: 1, fields: { balanceDollars: '200' } },
      { id: 'acct-4', schemaVersion: 1, fields: { balanceDollars: '1200' } },
      { id: 'acct-2', schemaVersion: 1, fields: { balanceDollars: '50' } },
    ];

    const m12 = migrator.executeAndProveMigration({
      migrationId: 'mig-v1-v2',
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      ruleTag: 'dollars-to-cents',
      preRecords: v1Records,
      transform: v1ToV2,
    });
    expect(migrator.verifyMigrationCertificate(m12.certificate, v1ToV2)).toBe(true);
    // Verifying with wrong transform function fails immediately
    expect(migrator.verifyMigrationCertificate(m12.certificate, v2ToV3)).toBe(false);

    const m23 = migrator.executeAndProveMigration({
      migrationId: 'mig-v2-v3',
      fromSchemaVersion: 2,
      toSchemaVersion: 3,
      ruleTag: 'assign-tiers',
      preRecords: m12.migratedRecords,
      transform: v2ToV3,
      auditSampleIndices: [0, 2, 3],
    });
    expect(m23.certificate.pairWitnesses.length).toBe(3);
    expect(migrator.verifyMigrationCertificate(m23.certificate, v2ToV3)).toBe(true);

    // Chained v1 -> v2 -> v3 audit
    expect(migrator.verifyMigrationChain([m12.certificate, m23.certificate], [v1ToV2, v2ToV3])).toBe(true);
    expect(
      migrator.verifyMigrationChain(
        [m12.certificate, { ...m23.certificate, preRoot: '00'.repeat(32) }],
        [v1ToV2, v2ToV3],
      ),
    ).toBe(false);

    // Tampered certificate digest fails
    expect(migrator.verifyMigrationCertificate({ ...m12.certificate, certificateDigest: 'ff'.repeat(32) }, v1ToV2)).toBe(false);
    expect(() =>
      migrator.executeAndProveMigration({
        migrationId: 'bad-ver',
        fromSchemaVersion: 2,
        toSchemaVersion: 2,
        ruleTag: 'noop',
        preRecords: v1Records,
        transform: v1ToV2,
      }),
    ).toThrow();

    const json = JSON.parse(migrator.serializeCertificate(m23.certificate)) as { recordCount: number; witnessCount: number };
    expect(json.recordCount).toBe(4);
    expect(json.witnessCount).toBe(3);
  });
});
