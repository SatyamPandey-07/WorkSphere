import { describe, it, expect } from 'vitest';
import { VerifiableThresholdDecryptionAudit, SUBGROUP_Q } from '../../core/zkp/VerifiableThresholdDecryptionAudit';

describe('VerifiableThresholdDecryptionAudit', () => {
  const engine = new VerifiableThresholdDecryptionAudit();

  it('batch-decrypts multiple ciphertexts with constant-size folded DLEQ proofs and isolates corrupt guardians', () => {
    const committee = engine.createCommittee('treasury-dec-2026', 3, [1, 2, 3, 4, 5]);
    const plaintexts = [
      { id: 'bid-a', val: 150n },
      { id: 'bid-b', val: 420n },
      { id: 'bid-c', val: 0n },
      { id: 'bid-d', val: 985n },
    ];
    const cts = plaintexts.map((p) => engine.encrypt(committee.groupPublicKey, p.id, p.val));

    const s1 = engine.produceGuardianBatchDecryption(committee, committee.guardians[0], cts);
    // Guardian 2 corrupts JUST the 3rd ciphertext partial -> single folded DLEQ MUST catch it!
    const s2Bad = engine.produceGuardianBatchDecryption(committee, committee.guardians[1], cts, 2);
    const s3 = engine.produceGuardianBatchDecryption(committee, committee.guardians[2], cts);
    const s5 = engine.produceGuardianBatchDecryption(committee, committee.guardians[4], cts);

    expect(engine.verifyGuardianBatchDecryption(committee, cts, s1)).toBe(true);
    expect(engine.verifyGuardianBatchDecryption(committee, cts, s2Bad)).toBe(false);

    const audit = engine.combineAndAuditBatch(committee, cts, [s1, s2Bad, s3, s5], 1200n);
    expect(audit.success).toBe(true);
    expect(audit.faultyGuardianIds).toEqual([2]);
    expect(audit.honestGuardianIds).toEqual([1, 3, 5]);
    expect(audit.decryptedValues).toEqual(plaintexts.map((p) => ({ id: p.id, value: p.val })));

    // Insufficient honest guardians (< 3) fails safely
    const failAudit = engine.combineAndAuditBatch(committee, cts, [s1, s2Bad, s3]);
    expect(failAudit.success).toBe(false);
    expect(failAudit.faultyGuardianIds).toEqual([2]);

    // Tampered response fails individual guardian verification
    expect(engine.verifyGuardianBatchDecryption(committee, cts, { ...s1, response: (s1.response + 1n) % SUBGROUP_Q })).toBe(false);

    const json = JSON.parse(engine.serializeAuditResult(audit)) as { decryptedCount: number; faultyGuardianIds: number[] };
    expect(json.decryptedCount).toBe(4);
    expect(json.faultyGuardianIds).toEqual([2]);
  });
});
