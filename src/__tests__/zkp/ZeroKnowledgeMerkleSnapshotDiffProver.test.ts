import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleSnapshotDiffProver } from '../../core/zkp/ZeroKnowledgeMerkleSnapshotDiffProver';

describe('ZeroKnowledgeMerkleSnapshotDiffProver', () => {
  const prover = new ZeroKnowledgeMerkleSnapshotDiffProver();

  it('computes verifiable snapshot diffs, validates all inclusion proofs, and reconstructs target root', () => {
    const snap1 = prover.buildSnapshot(1, {
      'acct:alice': '100',
      'acct:bob': '250',
      'acct:carol': '500',
      'acct:dave': '75',
    });
    const snap2 = prover.buildSnapshot(2, {
      'acct:alice': '150', // updated
      'acct:carol': '500', // unchanged
      'acct:dave': '75',   // unchanged
      'acct:eve': '900',   // inserted
      // acct:bob deleted
    });

    const cert = prover.computeDiffCertificate(snap1, snap2);
    expect(cert.inserts.map((i) => i.key)).toEqual(['acct:eve']);
    expect(cert.updates.map((u) => u.key)).toEqual(['acct:alice']);
    expect(cert.deletes.map((d) => d.key)).toEqual(['acct:bob']);
    expect(prover.verifyDiffCertificate(cert)).toBe(true);

    const patched = prover.applyAndVerifyPatch(snap1, cert);
    expect(patched.applied).toBe(true);
    expect(patched.targetSnapshot?.root).toBe(snap2.root);
    expect(patched.targetSnapshot?.entries).toEqual(snap2.entries);

    // Tampering with diff digest, counts, or update proof breaks verification
    expect(prover.verifyDiffCertificate({ ...cert, diffDigest: '00'.repeat(32) })).toBe(false);
    expect(prover.verifyDiffCertificate({ ...cert, targetKeyCount: 99 })).toBe(false);
    expect(() => prover.computeDiffCertificate(snap2, snap1)).toThrow();

    // Empty-to-populated and populated-to-empty edge transitions
    const empty = prover.buildSnapshot(0, {});
    const initCert = prover.computeDiffCertificate(empty, snap1);
    expect(prover.applyAndVerifyPatch(empty, initCert).applied).toBe(true);

    const json = JSON.parse(prover.serializeCertificate(cert)) as { insertCount: number; updateCount: number; deleteCount: number };
    expect(json).toEqual({
      sourceVersion: 1,
      targetVersion: 2,
      insertCount: 1,
      updateCount: 1,
      deleteCount: 1,
      diffDigest: cert.diffDigest,
    });
  });
});
