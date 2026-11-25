import { describe, it, expect } from 'vitest';
import { VerifiableDistributedAuditQuorumProver, SUBGROUP_Q } from '../../core/zkp/VerifiableDistributedAuditQuorumProver';

describe('VerifiableDistributedAuditQuorumProver', () => {
  it('seals supermajority audit certificates, records dissenting roots, and verifies multi-epoch audit chains', () => {
    const quorum = new VerifiableDistributedAuditQuorumProver('global-reserves-audit');
    const a1 = quorum.registerAuditor('deloitte-zk', 35n);
    const a2 = quorum.registerAuditor('pwc-zk', 35n);
    const a3 = quorum.registerAuditor('ey-zk', 20n);
    const a4 = quorum.registerAuditor('kpmg-zk', 10n);
    // Total weight = 100, supermajority quorum = 67

    const badSig = { ...quorum.signAttestation(a4, 0, 'root-ep0', quorum.genesisCertHash), sigS: 123n };
    const dissent = quorum.signAttestation(a3, 0, 'root-ep0-divergent', quorum.genesisCertHash);

    const ep0 = quorum.finalizeEpochAudit(0, quorum.genesisCertHash, [
      quorum.signAttestation(a1, 0, 'root-ep0', quorum.genesisCertHash),
      quorum.signAttestation(a2, 0, 'root-ep0', quorum.genesisCertHash),
      dissent,
      badSig,
    ]);
    expect(ep0.certificate).not.toBeNull();
    expect(ep0.invalidAuditorIds).toEqual(['kpmg-zk']);
    expect(ep0.certificate!.agreedWeight).toBe(70n);
    expect(ep0.certificate!.dissentingRoots.length).toBe(1);
    expect(ep0.certificate!.dissentingRoots[0].claimedRoot).toBe('root-ep0-divergent');
    expect(quorum.verifyCertificate(ep0.certificate!)).toBe(true);

    // Split vote (no root reaches 67) returns null certificate with full breakdown
    const split = quorum.finalizeEpochAudit(1, ep0.certificate!.certificateHash, [
      quorum.signAttestation(a1, 1, 'root-A', ep0.certificate!.certificateHash),
      quorum.signAttestation(a2, 1, 'root-B', ep0.certificate!.certificateHash),
      quorum.signAttestation(a3, 1, 'root-A', ep0.certificate!.certificateHash), // 55 < 67
    ]);
    expect(split.certificate).toBeNull();
    expect(split.rootBreakdown.length).toBe(2);

    // Honest epoch 1 consensus chains cleanly off epoch 0
    const ep1 = quorum.finalizeEpochAudit(1, ep0.certificate!.certificateHash, [
      quorum.signAttestation(a1, 1, 'root-ep1', ep0.certificate!.certificateHash),
      quorum.signAttestation(a2, 1, 'root-ep1', ep0.certificate!.certificateHash),
      quorum.signAttestation(a4, 1, 'root-ep1', ep0.certificate!.certificateHash),
    ]);
    expect(ep1.certificate).not.toBeNull();
    expect(quorum.verifyAuditChain([ep0.certificate!, ep1.certificate!])).toBe(true);
    expect(quorum.verifyAuditChain([ep0.certificate!, { ...ep1.certificate!, previousCertHash: '00'.repeat(32) }])).toBe(false);

    // Tampered attestation signature fails verification
    expect(
      quorum.verifyCertificate({
        ...ep1.certificate!,
        attestations: [
          { ...ep1.certificate!.attestations[0], sigS: (ep1.certificate!.attestations[0].sigS + 1n) % SUBGROUP_Q },
          ...ep1.certificate!.attestations.slice(1),
        ],
      }),
    ).toBe(false);

    const json = JSON.parse(quorum.serializeCertificate(ep0.certificate!)) as { agreedWeight: string; dissentCount: number };
    expect(json.agreedWeight).toBe('70');
    expect(json.dissentCount).toBe(1);
  });

  it('rejects duplicate auditors, wrong epochs, cross-scope attestations, and tampered certificate hashes', () => {
    const q = new VerifiableDistributedAuditQuorumProver('strict-audit-net');
    const a1 = q.registerAuditor('a1', 50n);
    const a2 = q.registerAuditor('a2', 30n);
    const a3 = q.registerAuditor('a3', 20n);

    expect(() => q.registerAuditor('a1', 10n)).toThrow();
    expect(() => q.registerAuditor('zero', 0n)).toThrow();
    expect(q.getTotalWeight()).toBe(100n);
    expect(q.getQuorumWeight()).toBe(67n);

    const att1 = q.signAttestation(a1, 0, 'root-0', q.genesisCertHash);
    const att2 = q.signAttestation(a2, 0, 'root-0', q.genesisCertHash);
    const wrongEp = q.signAttestation(a3, 1, 'root-0', q.genesisCertHash);

    // Duplicate a1 + wrong-epoch a3 isolated while a1(50) + a2(30) = 80 >= 67 succeeds
    const res = q.finalizeEpochAudit(0, q.genesisCertHash, [att1, att1, wrongEp, att2]);
    expect(res.certificate).not.toBeNull();
    expect(res.invalidAuditorIds).toEqual(['a1', 'a3']);
    expect(q.verifyCertificate(res.certificate!)).toBe(true);

    expect(q.verifyCertificate({ ...res.certificate!, scopeId: 'other' })).toBe(false);
    expect(q.verifyCertificate({ ...res.certificate!, certificateHash: '00'.repeat(32) })).toBe(false);
    expect(q.verifyCertificate({ ...res.certificate!, agreedWeight: 99n })).toBe(false);
    expect(q.verifyAuditChain([])).toBe(false);
    expect(q.verifyAttestation({ ...att1, auditorId: 'ghost' })).toBe(false);
  });
});
