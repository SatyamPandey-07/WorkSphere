import { describe, it, expect } from 'vitest';
import { ObliviousTransferBatchProver } from '../../core/zkp/ObliviousTransferBatchProver';

describe('ObliviousTransferBatchProver', () => {
  const ot = new ObliviousTransferBatchProver();

  it('transfers only the receiver-chosen slot with verified Schnorr setup and MAC integrity', () => {
    const messages = [
      'desk-key-floor-1',
      'desk-key-floor-2-secret',
      'desk-key-floor-3',
      'desk-key-floor-4',
    ];
    const sender = ot.initSender('ot-session-2026');
    expect(ot.verifySenderSetup(sender.setup)).toBe(true);

    const receiver = ot.createReceiverChoice(sender.setup, 1, messages.length);
    const bundle = ot.encryptBatchSlots(sender, receiver.blindedChoiceB, messages);

    const result = ot.decryptChosenSlot(bundle, receiver);
    expect(result.valid).toBe(true);
    expect(result.plaintext).toBe('desk-key-floor-2-secret');

    // Receiver cannot decrypt a non-chosen slot with their secretB
    const wrongChoice = { ...receiver, choiceIndex: 2 };
    expect(ot.decryptChosenSlot(bundle, wrongChoice).valid).toBe(false);
  });

  it('rejects tampered sender proofs and modified ciphertexts', () => {
    const sender = ot.initSender('ot-tamper');
    const badSetup = { ...sender.setup, proofResponse: sender.setup.proofResponse + 1n };
    expect(ot.verifySenderSetup(badSetup)).toBe(false);
    expect(() => ot.createReceiverChoice(badSetup, 0, 2)).toThrow();

    const receiver = ot.createReceiverChoice(sender.setup, 0, 2);
    const bundle = ot.encryptBatchSlots(sender, receiver.blindedChoiceB, ['alpha', 'beta']);
    const tamperedBundle = {
      ...bundle,
      slots: [{ ...bundle.slots[0], ciphertextHex: 'deadbeef' }, bundle.slots[1]],
    };
    expect(ot.decryptChosenSlot(tamperedBundle, receiver).valid).toBe(false);
  });

  it('executes multi-query OT batches and proves non-chosen slots remain unreadable', () => {
    const catalog = [
      'secret-badge-0',
      'secret-badge-1',
      'secret-badge-2',
      'secret-badge-3',
      'secret-badge-4',
    ];
    const sender = ot.initSender('ot-multi-2026');
    const batch = ot.executeMultiQueryBatch(sender, catalog, [0, 2, 4]);

    expect(batch.queries).toHaveLength(3);
    expect(batch.queries.map((q) => q.decrypted)).toEqual([
      'secret-badge-0',
      'secret-badge-2',
      'secret-badge-4',
    ]);
    expect(batch.batchReceiptDigest).toHaveLength(64);

    for (const q of batch.queries) {
      expect(ot.auditTransferBundle(q.bundle).valid).toBe(true);
      expect(ot.verifyNonChosenSlotsUnreadable(q.bundle, q.receiverState)).toBe(true);
    }
  });

  it('audits bundle transcript integrity and round-trips JSON serialization', () => {
    const sender = ot.initSender('ot-serialize-2026');
    const receiver = ot.createReceiverChoice(sender.setup, 1, 3);
    const bundle = ot.encryptBatchSlots(sender, receiver.blindedChoiceB, ['m0', 'm1', 'm2']);

    expect(ot.auditTransferBundle(bundle).valid).toBe(true);
    expect(ot.auditTransferBundle({ ...bundle, transcriptDigest: '0'.repeat(64) }).valid).toBe(false);
    expect(ot.auditTransferBundle({ ...bundle, sessionId: 'wrong-session' }).valid).toBe(false);

    const encoded = ot.serializeBundle(bundle);
    const decoded = ot.deserializeBundle(encoded);
    expect(ot.auditTransferBundle(decoded).valid).toBe(true);
    const decrypted = ot.decryptChosenSlot(decoded, receiver);
    expect(decrypted.valid).toBe(true);
    expect(decrypted.plaintext).toBe('m1');
  });
});
