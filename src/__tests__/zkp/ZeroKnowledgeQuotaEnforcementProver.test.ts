import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeQuotaEnforcementProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeQuotaEnforcementProver';

describe('ZeroKnowledgeQuotaEnforcementProver', () => {
  const engine = new ZeroKnowledgeQuotaEnforcementProver();

  it('proves cumulative hidden usage stays within quota limit and rejects quota overruns', () => {
    const events = [
      engine.recordUsageEvent('tenant-42', '2026-11', 'req-1', 120n, 12),
      engine.recordUsageEvent('tenant-42', '2026-11', 'req-2', 350n, 12),
      engine.recordUsageEvent('tenant-42', '2026-11', 'req-3', 530n, 12),
    ];
    // Total usage = 1000n

    const exactCert = engine.generateQuotaComplianceCertificate('tenant-42', '2026-11', 1000n, events, 14);
    expect(engine.verifyQuotaCompliance(exactCert)).toBe(true);

    const slackCert = engine.generateQuotaComplianceCertificate('tenant-42', '2026-11', 2500n, events, 14);
    expect(engine.verifyQuotaCompliance(slackCert)).toBe(true);

    // Overrun (999 < 1000) must throw
    expect(() => engine.generateQuotaComplianceCertificate('tenant-42', '2026-11', 999n, events, 14)).toThrow();
    // Negative event injection must throw
    expect(() => engine.recordUsageEvent('tenant-42', '2026-11', 'neg', -5n, 12)).toThrow();

    const json = JSON.parse(engine.serializeCertificate(slackCert)) as { eventCount: number; quotaLimit: string };
    expect(json.eventCount).toBe(3);
    expect(json.quotaLimit).toBe('2500');
  });

  it('rejects duplicate event IDs, dropped events, tightened quota claims, and tampered bit proofs', () => {
    const e1 = engine.recordUsageEvent('org-9', 'ep-1', 'e1', 50n, 10);
    const e2 = engine.recordUsageEvent('org-9', 'ep-1', 'e2', 75n, 10);

    expect(() => engine.generateQuotaComplianceCertificate('org-9', 'ep-1', 500n, [e1, e1], 12)).toThrow();

    const cert = engine.generateQuotaComplianceCertificate('org-9', 'ep-1', 200n, [e1, e2], 12);
    expect(engine.verifyQuotaCompliance(cert)).toBe(true);

    expect(engine.verifyQuotaCompliance({ ...cert, quotaLimit: 199n })).toBe(false);
    expect(engine.verifyQuotaCompliance({ ...cert, epochId: 'ep-2' })).toBe(false);
    expect(engine.verifyQuotaCompliance({ ...cert, cumulativeCommitment: (cert.cumulativeCommitment * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(
      engine.verifyQuotaCompliance({
        ...cert,
        headroomProof: {
          ...cert.headroomProof,
          bits: cert.headroomProof.bits.map((b, i) => (i === 0 ? { ...b, s0: (b.s0 + 1n) % SUBGROUP_Q } : b)),
        },
      }),
    ).toBe(false);
    expect(engine.verifyQuotaCompliance({ ...cert, eventIds: ['e1', 'e1'] })).toBe(false);
  });

  it('handles zero-event epochs, zero-amount usage events, and rejects forged event commitments', () => {
    // Empty epoch with quota 500
    const emptyCert = engine.generateQuotaComplianceCertificate('idle-tenant', '2026-12', 500n, [], 12);
    expect(engine.verifyQuotaCompliance(emptyCert)).toBe(true);
    expect(emptyCert.cumulativeCommitment).toBe(1n);

    // Zero-amount events + positive events
    const z0 = engine.recordUsageEvent('zero-tenant', '2026-12', 'z0', 0n, 10);
    const z1 = engine.recordUsageEvent('zero-tenant', '2026-12', 'z1', 255n, 10);
    const zCert = engine.generateQuotaComplianceCertificate('zero-tenant', '2026-12', 255n, [z0, z1], 12);
    expect(engine.verifyQuotaCompliance(zCert)).toBe(true);

    // Tampered single event range proof or commitment mismatch must fail
    expect(
      engine.verifyQuotaCompliance({
        ...zCert,
        eventCommitments: [(zCert.eventCommitments[0] * 4n) % SAFE_PRIME_P, zCert.eventCommitments[1]],
      }),
    ).toBe(false);
    expect(
      engine.verifyQuotaCompliance({
        ...zCert,
        headroomCommitment: (zCert.headroomCommitment * 4n) % SAFE_PRIME_P,
      }),
    ).toBe(false);
    expect(() => engine.generateQuotaComplianceCertificate('bad-limit', 'ep', -1n, [], 12)).toThrow();
    expect(() => engine.recordUsageEvent('bad-bits', 'ep', 'big', 1024n, 10)).toThrow();
  });
});
