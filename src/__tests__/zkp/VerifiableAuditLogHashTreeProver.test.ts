import { describe, it, expect } from 'vitest';
import { VerifiableAuditLogHashTreeProver } from '../../core/zkp/VerifiableAuditLogHashTreeProver';

describe('VerifiableAuditLogHashTreeProver', () => {
  it('seals multi-epoch Merkle audit blocks and verifies cross-epoch dual-layer event proofs', () => {
    const log = new VerifiableAuditLogHashTreeProver('ws-sec-log', 'seed-2026');

    log.recordEvent('ev-1', 'alice', 'CREATE_ROLE', '{"role":"auditor"}', 1000);
    log.recordEvent('ev-2', 'bob', 'GRANT_ACCESS', '{"scope":"floor-3"}', 1100);
    log.recordEvent('ev-3', 'carol', 'UPDATE_QUOTA', '{"limit":500}', 1200);
    const ep0 = log.sealCurrentEpoch();

    log.recordEvent('ev-4', 'dave', 'ROTATE_KEY', '{"epoch":2}', 2000);
    log.recordEvent('ev-5', 'eve', 'EXPORT_AUDIT', '{"ok":true}', 2100);
    const ep1 = log.sealCurrentEpoch();

    log.recordEvent('ev-6', 'frank', 'CLOSE_TICKET', '{"id":42}', 3000);
    const ep2 = log.sealCurrentEpoch();

    expect(ep1.previousEpochHash).toBe(ep0.epochHash);
    expect(ep2.previousEpochHash).toBe(ep1.epochHash);

    const anchor = log.getLatestAnchorHash();
    const p2 = log.generateEventProof('ev-2');
    const p5 = log.generateEventProof('ev-5');
    const p6 = log.generateEventProof('ev-6');

    expect(log.verifyEventProof(p2, anchor, '{"scope":"floor-3"}').valid).toBe(true);
    expect(log.verifyEventProof(p2, anchor, '{"scope":"floor-9"}').valid).toBe(false);
    expect(log.batchVerifyProofs([p2, p5, p6], anchor).allValid).toBe(true);

    // Tampered anchor or event action must fail verification
    expect(log.verifyEventProof(p5, '0'.repeat(64)).valid).toBe(false);
    expect(log.verifyEventProof({ ...p5, event: { ...p5.event, action: 'DELETE_LOG' } }, anchor).valid).toBe(false);

    const json = log.serializeProof(p2);
    const restored = log.deserializeProof(json);
    expect(restored).toEqual(p2);
    expect(log.verifyEventProof(restored, anchor).valid).toBe(true);
  });
});
