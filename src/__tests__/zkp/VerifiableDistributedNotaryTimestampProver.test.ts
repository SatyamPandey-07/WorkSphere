import { describe, it, expect } from 'vitest';
import { VerifiableDistributedNotaryTimestampProver, SUBGROUP_Q } from '../../core/zkp/VerifiableDistributedNotaryTimestampProver';

describe('VerifiableDistributedNotaryTimestampProver', () => {
  it('stamps document batches with threshold notary attestations and verifies offline receipts and chains', () => {
    const tsa = new VerifiableDistributedNotaryTimestampProver('global-notary-v1', 3);
    const n1 = tsa.registerNotary('notary-us');
    const n2 = tsa.registerNotary('notary-eu');
    const n3 = tsa.registerNotary('notary-ap');
    const n4 = tsa.registerNotary('notary-sa');
    const rogue = { notaryId: 'rogue', secretKey: 123n, publicKey: 4n };

    const b0 = tsa.stampDocumentBatch({
      documents: [
        { documentId: 'patent-01', content: 'Invention disclosure alpha' },
        { documentId: 'contract-02', content: 'SLA agreement 2026' },
        { documentId: 'audit-03', content: 'SOC2 report hash' },
      ],
      utcTimestampMs: 1700001000000,
      anchorBlockHeight: 50000,
      signingNotaries: [n1, n2, n3, rogue, n1],
    });
    expect(b0.rejectedNotaries).toEqual(['rogue', 'notary-us']);
    expect(tsa.verifyHeader(b0.header)).toBe(true);

    const recContract = b0.receipts['contract-02'];
    expect(tsa.verifyReceipt(recContract, 'SLA agreement 2026')).toBe(true);
    expect(tsa.verifyReceipt(recContract, 'SLA agreement TAMPERED')).toBe(false);

    const b1 = tsa.stampDocumentBatch({
      documents: [{ documentId: 'release-04', content: 'v2.4.0 binary digest' }],
      utcTimestampMs: 1700002000000,
      anchorBlockHeight: 50010,
      signingNotaries: [n2, n3, n4],
    });

    expect(tsa.verifyTimestampChain([b0.header, b1.header])).toBe(true);
    expect(tsa.verifyTimestampChain([b0.header, { ...b1.header, utcTimestampMs: 1700000000000 }])).toBe(false);

    // Backdated timestamp or insufficient quorum throws
    expect(() =>
      tsa.stampDocumentBatch({
        documents: [{ documentId: 'back', content: 'x' }],
        utcTimestampMs: 1700001500000,
        anchorBlockHeight: 50020,
        signingNotaries: [n1, n2, n3],
      }),
    ).toThrow();
    expect(() =>
      tsa.stampDocumentBatch({
        documents: [{ documentId: 'lowq', content: 'x' }],
        utcTimestampMs: 1700003000000,
        anchorBlockHeight: 50020,
        signingNotaries: [n1, n2],
      }),
    ).toThrow();

    // Tampered attestation signature fails receipt verification
    expect(
      tsa.verifyHeader({
        ...b0.header,
        attestations: [{ ...b0.header.attestations[0], sigS: (b0.header.attestations[0].sigS + 1n) % SUBGROUP_Q }, ...b0.header.attestations.slice(1)],
      }),
    ).toBe(false);

    const json = JSON.parse(tsa.serializeReceipt(recContract)) as { documentId: string; notaryCount: number };
    expect(json.documentId).toBe('contract-02');
    expect(json.notaryCount).toBe(3);
  });
});
