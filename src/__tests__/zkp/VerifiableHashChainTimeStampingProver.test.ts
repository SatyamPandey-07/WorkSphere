import { describe, it, expect } from 'vitest';
import { VerifiableHashChainTimeStampingProver } from '../../core/zkp/VerifiableHashChainTimeStampingProver';

describe('VerifiableHashChainTimeStampingProver', () => {
  it('stamps documents into a skip-linked hash chain and verifies anchored receipts', () => {
    const tsa = new VerifiableHashChainTimeStampingProver('ws-tsa-prod', 'seed-2026');
    for (let i = 0; i < 10; i++) {
      tsa.stampDocument(`doc-${i}`, `payload-version-${i}`, 1700000000000 + i * 1000);
    }

    const audit = tsa.auditFullChain();
    expect(audit.valid).toBe(true);
    expect(audit.corruptedSequences).toEqual([]);

    const anchorHash = tsa.getHeadHash();
    const receipt = tsa.issueReceipt('doc-3');
    expect(tsa.verifyReceipt(receipt, 'payload-version-3', anchorHash).valid).toBe(true);
    expect(tsa.verifyReceipt(receipt, 'altered-payload', anchorHash).valid).toBe(false);
    expect(tsa.verifyReceipt(receipt, 'payload-version-3', '0'.repeat(64)).valid).toBe(false);
  });

  it('proves chronological precedence, enforces monotonic timestamps, and round-trips serialization', () => {
    const tsa = new VerifiableHashChainTimeStampingProver('ws-tsa-order', 'seed-order');
    tsa.stampDocument('patent-draft', 'v1', 1000);
    tsa.stampDocument('review-1', 'ok', 2000);
    tsa.stampDocument('review-2', 'ok2', 3000);
    tsa.stampDocument('final-filing', 'v2', 4000);

    // Non-monotonic timestamp must throw
    expect(() => tsa.stampDocument('backdated', 'cheat', 3500)).toThrow();

    const orderProof = tsa.proveChronologicalOrder('patent-draft', 'final-filing');
    expect(tsa.verifyChronologicalOrder(orderProof).valid).toBe(true);

    const tamperedOrder = {
      ...orderProof,
      chainSegment: [
        orderProof.chainSegment[0],
        { ...orderProof.chainSegment[1], timestampMs: 2001 },
        ...orderProof.chainSegment.slice(2),
      ],
    };
    expect(tsa.verifyChronologicalOrder(tamperedOrder).valid).toBe(false);

    const receipt = tsa.issueReceipt('patent-draft');
    const json = tsa.serializeReceipt(receipt);
    const restored = tsa.deserializeReceipt(json);
    expect(restored).toEqual(receipt);
    expect(tsa.verifyReceipt(restored, 'v1', tsa.getHeadHash()).valid).toBe(true);
  });
});
