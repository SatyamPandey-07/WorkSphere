import { describe, it, expect } from 'vitest';
import { VerifiableThresholdBLSStyleBatchSigner, SAFE_PRIME_P } from '../../core/zkp/VerifiableThresholdBLSStyleBatchSigner';

describe('VerifiableThresholdBLSStyleBatchSigner', () => {
  const engine = new VerifiableThresholdBLSStyleBatchSigner();

  it('produces quorum-independent unique threshold signatures and verifies folded multi-message batches', () => {
    const group = engine.createGroup('bls-style-quorum-2026', 3, [1, 2, 3, 4, 5]);
    const msgs = ['tx-batch-101', 'tx-batch-102', 'tx-batch-103'];

    const sigs = msgs.map((m) => {
      const badP2 = { ...engine.signPartial(group, group.signers[1], m), responseS: 999n };
      const res = engine.aggregateSignature(group, m, [
        engine.signPartial(group, group.signers[0], m),
        badP2,
        engine.signPartial(group, group.signers[2], m),
        engine.signPartial(group, group.signers[4], m),
      ]);
      expect(res.faultySignerIds).toEqual([2]);
      expect(res.signature).not.toBeNull();
      expect(engine.verifyThresholdSignature(group, res.signature!)).toBe(true);
      return res.signature!;
    });

    // Different quorum {2, 4, 5} signing msg[0] yields the EXACT SAME unique signature!
    const altSig = engine.aggregateSignature(group, msgs[0], [
      engine.signPartial(group, group.signers[1], msgs[0]),
      engine.signPartial(group, group.signers[3], msgs[0]),
      engine.signPartial(group, group.signers[4], msgs[0]),
    ]);
    expect(altSig.signature!.signature).toBe(sigs[0].signature);

    // Multi-message folded batch proof
    const batchProof = engine.createMultiMessageBatchProof(group, [group.signers[0], group.signers[2], group.signers[3]], sigs);
    expect(engine.verifyMultiMessageBatchProof(group, batchProof)).toBe(true);

    // Corrupting any single signature in the batch breaks folded verification
    const badItems = batchProof.items.map((it, i) => (i === 1 ? { ...it, signature: (it.signature * 4n) % SAFE_PRIME_P } : it));
    expect(engine.verifyMultiMessageBatchProof(group, { ...batchProof, items: badItems })).toBe(false);

    const json = JSON.parse(engine.serializeBatchProof(batchProof)) as { messageCount: number; quorumCount: number };
    expect(json).toEqual({ groupId: 'bls-style-quorum-2026', messageCount: 3, quorumCount: 3 });
  });
});
